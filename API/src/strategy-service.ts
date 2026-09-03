import { keccak256, stringToHex } from "viem";
import type { ApiConfig } from "./config.js";
import type {
  ExecutionStrategy,
  OnchainStrategy,
} from "./execution-types.js";
import {
  executionTraderAddress,
  isExecutionTraderAddress,
} from "./execution-addresses.js";
import type { EvmAddress } from "./market-types.js";
import {
  OnchainStrategyRegistry,
  type FundedStrategyRecord,
  type StrategyRegistry,
} from "./onchain-strategy-registry.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { StockCatalogService as Catalog } from "./stock-catalog.js";
import type { StrategyStore } from "./strategy-store.js";

type Dependencies = {
  catalog?: Pick<StockCatalogService, "assessTicker" | "catalog">;
  now?: () => number;
  registry?: StrategyRegistry;
};

export class StrategyService {
  private readonly catalog: Pick<
    StockCatalogService,
    "assessTicker" | "catalog"
  >;
  private readonly now: () => number;
  private readonly registry: StrategyRegistry;

  constructor(
    private readonly config: ApiConfig,
    private readonly store: StrategyStore,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog ?? new Catalog(config);
    this.now = dependencies.now ?? Date.now;
    this.registry =
      dependencies.registry ?? new OnchainStrategyRegistry(config);
  }

  async create(input: {
    owner: EvmAddress;
    agent: EvmAddress;
    ticker: string;
    inputToken: EvmAddress;
    outputToken: EvmAddress;
    router: EvmAddress;
    maxAmountPerTrade: string;
    maxTotalSpend: string;
    maxSlippageBps: number;
    expiresAt: string;
  }): Promise<ExecutionStrategy> {
    const validated = await this.validateDefinition(input);
    return this.store.create({
      ...input,
      ticker: validated.ticker,
      executionMode: validated.orchestrationReady ? "full" : "analysis",
    });
  }

  async restore(
    strategy: ExecutionStrategy,
    owner: EvmAddress,
  ): Promise<ExecutionStrategy> {
    if (strategy.onchain) {
      return this.bindOnchain(strategy.id, owner, strategy.onchain);
    }
    if (
      !sameAddress(strategy.owner, owner) ||
      strategy.status !== "active" ||
      strategy.spent !== "0" ||
      strategy.humanProof.provider !== "owner-wallet-session" ||
      strategy.humanProof.status !== "verified" ||
      strategy.humanProof.proofHash !== proofHash(strategy.id, owner)
    ) {
      throw new Error("Strategy snapshot does not match the owner session");
    }
    await this.validateDefinition(strategy);
    const restored = this.store.restore(strategy);
    if (!restored) {
      throw new Error("Strategy snapshot conflicts with the active strategy");
    }
    return restored;
  }

  async bindOnchain(
    id: string,
    owner: EvmAddress,
    onchain: OnchainStrategy,
  ): Promise<ExecutionStrategy> {
    if (!this.store.strategy(id, owner)) {
      const record = await this.registry.verify(owner, onchain);
      const recovered = await this.fromRecord(id, record);
      if (!this.store.restore(recovered)) {
        throw new Error("Strategy recovery conflicts with the active record");
      }
    }
    const strategy = this.store.bindOnchain(id, owner, onchain);
    if (!strategy) {
      throw new Error("Strategy cannot be linked to this onchain record");
    }
    return strategy;
  }

  async recover(
    id: string,
    owner: EvmAddress,
  ): Promise<ExecutionStrategy | undefined> {
    const template = this.store.strategy(id, owner);
    if (!template) {
      throw new Error("Strategy snapshot is required before recovery");
    }
    const record = await this.registry.find(owner, template);
    if (!record) return undefined;
    const recovered = await this.fromRecord(
      `onchain-4663-${record.onchain.strategyId}`,
      record,
    );
    const stored = this.store.restore(recovered);
    if (!stored) {
      throw new Error("Funded strategy conflicts with the active record");
    }
    return stored;
  }

  private async validateDefinition(input: {
    owner: EvmAddress;
    agent: EvmAddress;
    ticker: string;
    inputToken: EvmAddress;
    outputToken: EvmAddress;
    router: EvmAddress;
    maxAmountPerTrade: string;
    maxTotalSpend: string;
    maxSlippageBps: number;
    expiresAt: string;
  }): Promise<{ ticker: string; orchestrationReady: boolean }> {
    const expectedAgent = executionTraderAddress(
      this.config,
      input.owner,
    );
    if (
      expectedAgent
        ? !isExecutionTraderAddress(
            this.config,
            input.owner,
            input.agent,
          )
        : !sameAddress(input.agent, input.owner)
    ) {
      throw new Error("Strategy agent is not the authorized trader");
    }
    if (!sameAddress(input.inputToken, this.config.INPUT_TOKEN_ADDRESS)) {
      throw new Error("Strategy input token must be Robinhood USDG");
    }
    if (
      !sameAddress(
        input.router,
        this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
      )
    ) {
      throw new Error("Strategy router is not the authorized Uniswap router");
    }
    if (BigInt(input.maxTotalSpend) < BigInt(input.maxAmountPerTrade)) {
      throw new Error("Total spend must cover at least one trade");
    }
    const expiresAt = Date.parse(input.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now() ||
      expiresAt > this.now() + 7 * 86_400_000
    ) {
      throw new Error("Strategy expiry must be within the next seven days");
    }

    const ticker = input.ticker.trim().toUpperCase();
    const asset = await this.catalog.assessTicker(ticker);
    if (
      !asset ||
      !sameAddress(asset.tokenAddress, input.outputToken)
    ) {
      throw new Error("Robinhood ticker and output token do not match");
    }
    return {
      ticker,
      orchestrationReady: asset.orchestrationReady,
    };
  }

  private async fromRecord(
    id: string,
    record: FundedStrategyRecord,
  ): Promise<ExecutionStrategy> {
    const catalog = await this.catalog.catalog();
    const asset = catalog.assets.find((candidate) =>
      sameAddress(candidate.tokenAddress, record.outputToken),
    );
    if (!asset) {
      throw new Error("Funded output token is not in the Robinhood catalog");
    }
    return {
      id,
      ticker: asset.ticker,
      owner: record.owner,
      agent: record.agent,
      inputToken: record.inputToken,
      outputToken: record.outputToken,
      router: record.router,
      maxAmountPerTrade: record.maxAmountPerTrade,
      maxTotalSpend: record.maxTotalSpend,
      spent: record.spent,
      maxSlippageBps: record.maxSlippageBps,
      expiresAt: record.expiresAt,
      status: "active",
      humanProof: {
        provider: "owner-wallet-session",
        status: "verified",
        proofHash: record.humanProofHash,
      },
      executionMode: asset.uniswapRoutable ? "full" : "analysis",
      onchain: record.onchain,
    };
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function proofHash(id: string, owner: EvmAddress): `0x${string}` {
  return keccak256(stringToHex(`${id}:${owner.toLowerCase()}`));
}
