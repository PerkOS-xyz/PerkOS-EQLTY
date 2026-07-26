import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  parseEventLogs,
  type Address,
} from "viem";
import type { ApiConfig } from "./config.js";
import { eqltyVaultAbi } from "./eqlty-vault-abi.js";
import { executionTraderAddress } from "./execution-addresses.js";
import type {
  ExecutionStrategy,
  OnchainStrategy,
} from "./execution-types.js";
import type { EvmAddress } from "./market-types.js";

const approvalAbi = [
  {
    type: "event",
    name: "Approval",
    anonymous: false,
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export type FundedStrategyRecord = {
  owner: EvmAddress;
  agent: EvmAddress;
  inputToken: EvmAddress;
  outputToken: EvmAddress;
  router: EvmAddress;
  maxAmountPerTrade: string;
  maxTotalSpend: string;
  spent: string;
  maxSlippageBps: number;
  expiresAt: string;
  humanProofHash: `0x${string}`;
  available: string;
  onchain: OnchainStrategy;
};

export type StrategyRegistry = {
  verify(
    owner: EvmAddress,
    onchain: OnchainStrategy,
  ): Promise<FundedStrategyRecord>;
  find(
    owner: EvmAddress,
    template: ExecutionStrategy,
  ): Promise<FundedStrategyRecord | undefined>;
};

export class OnchainStrategyRegistry implements StrategyRegistry {
  constructor(private readonly config: ApiConfig) {}

  async verify(
    owner: EvmAddress,
    onchain: OnchainStrategy,
  ): Promise<FundedStrategyRecord> {
    const client = this.client();
    const vault = this.vault();
    const strategyId = BigInt(onchain.strategyId);
    const [creationReceipt, approvalReceipt, fundingReceipt] =
      await Promise.all([
        client.getTransactionReceipt({
          hash: onchain.creationTransactionHash,
        }),
        client.getTransactionReceipt({
          hash: onchain.approvalTransactionHash,
        }),
        client.getTransactionReceipt({
          hash: onchain.fundingTransactionHash,
        }),
      ]);
    if (
      creationReceipt.status !== "success" ||
      approvalReceipt.status !== "success" ||
      fundingReceipt.status !== "success"
    ) {
      throw new Error("Strategy setup transactions are not successful");
    }

    const created = parseEventLogs({
      abi: eqltyVaultAbi,
      eventName: "StrategyCreated",
      logs: creationReceipt.logs,
      strict: true,
    }).find(
      (event) =>
        event.address.toLowerCase() === vault.toLowerCase() &&
        event.args.strategyId === strategyId &&
        sameAddress(event.args.owner, owner),
    );
    const funded = parseEventLogs({
      abi: eqltyVaultAbi,
      eventName: "StrategyFunded",
      logs: fundingReceipt.logs,
      strict: true,
    }).find(
      (event) =>
        event.address.toLowerCase() === vault.toLowerCase() &&
        event.args.strategyId === strategyId,
    );
    if (!created || !funded || funded.args.available === 0n) {
      throw new Error("Funded strategy events do not match the owner");
    }
    const approved = parseEventLogs({
      abi: approvalAbi,
      eventName: "Approval",
      logs: approvalReceipt.logs,
      strict: true,
    }).find(
      (event) =>
        sameAddress(event.args.owner, owner) &&
        sameAddress(event.args.spender, vault) &&
        event.args.value >= funded.args.amount,
    );
    if (!approved) {
      throw new Error("USDG approval does not match the funded strategy");
    }

    return this.readRecord(owner, strategyId, onchain);
  }

  async find(
    owner: EvmAddress,
    template: ExecutionStrategy,
  ): Promise<FundedStrategyRecord | undefined> {
    const start = this.config.EQLTY_VAULT_DEPLOYMENT_BLOCK;
    if (!start) return undefined;
    const client = this.client();
    const vault = this.vault();
    const [createdLogs, fundedLogs] = await Promise.all([
      client.getLogs({
        address: vault,
        event: eqltyVaultAbi[0],
        args: { owner },
        fromBlock: BigInt(start),
        toBlock: "latest",
      }),
      client.getLogs({
        address: vault,
        event: eqltyVaultAbi[1],
        fromBlock: BigInt(start),
        toBlock: "latest",
      }),
    ]);
    const candidates = createdLogs
      .filter(
        (event) =>
          event.args.strategyId !== undefined &&
          sameAddress(event.args.agent, template.agent) &&
          sameAddress(event.args.inputToken, template.inputToken) &&
          sameAddress(event.args.outputToken, template.outputToken) &&
          sameAddress(event.args.router, template.router) &&
          event.args.maxAmountPerTrade ===
            BigInt(template.maxAmountPerTrade) &&
          event.args.maxTotalSpend === BigInt(template.maxTotalSpend) &&
          event.args.maxSlippageBps ===
            BigInt(template.maxSlippageBps),
      )
      .sort((left, right) =>
        Number(
          (right.args.strategyId ?? 0n) -
            (left.args.strategyId ?? 0n),
        ),
      );

    for (const created of candidates) {
      const strategyId = created.args.strategyId!;
      const funding = fundedLogs
        .filter(
          (event) =>
            event.args.strategyId === strategyId &&
            event.transactionHash &&
            event.blockNumber,
        )
        .sort((left, right) =>
          Number((right.blockNumber ?? 0n) - (left.blockNumber ?? 0n)),
        )[0];
      if (
        !created.transactionHash ||
        !created.blockNumber ||
        !funding?.transactionHash ||
        !funding.blockNumber
      ) {
        continue;
      }
      const approvals = await client.getLogs({
        address: template.inputToken,
        event: approvalAbi[0],
        args: { owner, spender: vault },
        fromBlock: created.blockNumber,
        toBlock: funding.blockNumber,
      });
      const approval = approvals
        .filter(
          (event) =>
            event.transactionHash &&
            event.args.value !== undefined &&
            event.args.value >= BigInt(template.maxAmountPerTrade),
        )
        .sort((left, right) =>
          Number((right.blockNumber ?? 0n) - (left.blockNumber ?? 0n)),
        )[0];
      if (!approval?.transactionHash) continue;

      try {
        const onchain = {
          chainId: 4663,
          strategyId: strategyId.toString(),
          creationTransactionHash: created.transactionHash,
          approvalTransactionHash: approval.transactionHash,
          fundingTransactionHash: funding.transactionHash,
        } satisfies OnchainStrategy;
        const record = await this.readRecord(owner, strategyId, onchain);
        if (BigInt(record.available) >= BigInt(template.maxAmountPerTrade)) {
          return record;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async readRecord(
    owner: EvmAddress,
    strategyId: bigint,
    onchain: OnchainStrategy,
  ): Promise<FundedStrategyRecord> {
    const client = this.client();
    const [stored, available] = await Promise.all([
      client.readContract({
        address: this.vault(),
        abi: eqltyVaultAbi,
        functionName: "strategies",
        args: [strategyId],
      }),
      client.readContract({
        address: this.vault(),
        abi: eqltyVaultAbi,
        functionName: "availableBalance",
        args: [strategyId],
      }),
    ]);
    if (!sameAddress(stored[0], owner)) {
      throw new Error("Funded strategy owner does not match the session");
    }
    if (
      !sameAddress(stored[1], templateAgent(this.config, owner)) ||
      !sameAddress(stored[2], this.config.INPUT_TOKEN_ADDRESS) ||
      !sameAddress(
        stored[4],
        this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
      )
    ) {
      throw new Error("Funded strategy contracts do not match EQLTY");
    }
    if (
      stored[10] ||
      stored[11] ||
      stored[8] <= BigInt(Math.floor(Date.now() / 1_000)) ||
      available === 0n
    ) {
      throw new Error("Funded strategy is not active");
    }
    return {
      owner: getAddress(stored[0]),
      agent: getAddress(stored[1]),
      inputToken: getAddress(stored[2]),
      outputToken: getAddress(stored[3]),
      router: getAddress(stored[4]),
      maxAmountPerTrade: stored[5].toString(),
      maxTotalSpend: stored[6].toString(),
      spent: stored[7].toString(),
      expiresAt: new Date(Number(stored[8]) * 1_000).toISOString(),
      maxSlippageBps: Number(stored[9]),
      humanProofHash: stored[12],
      available: available.toString(),
      onchain,
    };
  }

  private client() {
    const rpcUrl = this.config.ROBINHOOD_MAINNET_RPC_URL;
    if (!rpcUrl) {
      throw new Error("Robinhood RPC is required for strategy recovery");
    }
    return createPublicClient({
      chain: defineChain({
        id: 4663,
        name: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }),
      transport: http(rpcUrl),
    });
  }

  private vault(): Address {
    if (!this.config.EQLTY_VAULT_ADDRESS) {
      throw new Error("EQLTY vault is required for strategy recovery");
    }
    return getAddress(this.config.EQLTY_VAULT_ADDRESS);
  }
}

function templateAgent(
  config: ApiConfig,
  owner: EvmAddress,
): EvmAddress {
  return executionTraderAddress(config) ?? owner;
}

function sameAddress(
  left: string | undefined,
  right: string,
): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}
