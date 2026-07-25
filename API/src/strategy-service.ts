import type { ApiConfig } from "./config.js";
import type { ExecutionStrategy } from "./execution-types.js";
import type { EvmAddress } from "./market-types.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { StockCatalogService as Catalog } from "./stock-catalog.js";
import type { StrategyStore } from "./strategy-store.js";

type Dependencies = {
  catalog?: Pick<StockCatalogService, "assessTicker">;
  now?: () => number;
};

export class StrategyService {
  private readonly catalog: Pick<StockCatalogService, "assessTicker">;
  private readonly now: () => number;

  constructor(
    private readonly config: ApiConfig,
    private readonly store: StrategyStore,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog ?? new Catalog(config);
    this.now = dependencies.now ?? Date.now;
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
    const expectedAgent =
      this.config.ENS_TRADER_ADDRESS ?? input.owner;
    if (!sameAddress(input.agent, expectedAgent)) {
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

    return this.store.create({
      ...input,
      ticker,
      executionMode: asset.orchestrationReady ? "full" : "analysis",
    });
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
