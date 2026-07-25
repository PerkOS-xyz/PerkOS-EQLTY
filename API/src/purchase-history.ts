import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
} from "viem";
import type { ApiConfig } from "./config.js";
import { eqltyVaultAbi } from "./eqlty-vault-abi.js";
import type { EvmAddress } from "./market-types.js";
import type { StockCatalogService } from "./stock-catalog.js";

type VaultStrategy = readonly [
  owner: Address,
  agent: Address,
  inputToken: Address,
  outputToken: Address,
  router: Address,
  maxAmountPerTrade: bigint,
  maxTotalSpend: bigint,
  spent: bigint,
  expiresAt: bigint,
  maxSlippageBps: number,
  paused: boolean,
  revoked: boolean,
  humanProofHash: `0x${string}`,
];

const tokenDecimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export type PurchaseHistoryEntry = {
  id: string;
  status: "executed";
  strategyId: string;
  nonce: string;
  ticker?: string;
  inputToken: EvmAddress;
  outputToken: EvmAddress;
  outputDecimals?: number;
  amountIn: string;
  amountOut: string;
  router: EvmAddress;
  signalHash: `0x${string}`;
  quoteHash: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
  executedAt: string;
};

export type PurchaseHistory = {
  source: "robinhood-chain";
  status: "ready" | "pending";
  vault?: EvmAddress;
  entries: PurchaseHistoryEntry[];
};

type Dependencies = {
  catalog?: Pick<StockCatalogService, "catalog">;
};

export class PurchaseHistoryService {
  private readonly catalog?: Pick<StockCatalogService, "catalog">;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog;
  }

  async list(owner: EvmAddress): Promise<PurchaseHistory> {
    const vault = this.config.EQLTY_VAULT_ADDRESS as
      | EvmAddress
      | undefined;
    const rpcUrl = this.config.ROBINHOOD_MAINNET_RPC_URL;
    const start = this.config.EQLTY_VAULT_DEPLOYMENT_BLOCK;
    if (!vault || !rpcUrl || start === undefined) {
      return {
        source: "robinhood-chain",
        status: "pending",
        vault,
        entries: [],
      };
    }

    const chain = defineChain({
      id: 4663,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    if ((await client.getChainId()) !== 4663) {
      throw new Error("History RPC is not Robinhood Chain");
    }
    const code = await client.getCode({ address: vault });
    if (!code || code === "0x") {
      throw new Error("EQLTY vault bytecode is missing");
    }

    const logs = await client.getContractEvents({
      address: vault,
      abi: eqltyVaultAbi,
      eventName: "TradeExecuted",
      fromBlock: BigInt(start),
      toBlock: "latest",
    });
    const strategyIds = [
      ...new Set(logs.map((log) => String(log.args.strategyId))),
    ];
    const strategies = new Map<string, VaultStrategy>();
    for (const strategyId of strategyIds) {
      strategies.set(
        strategyId,
        await client.readContract({
          address: vault,
          abi: eqltyVaultAbi,
          functionName: "strategies",
          args: [BigInt(strategyId)],
        }),
      );
    }
    const blockNumbers = [
      ...new Set(logs.map((log) => log.blockNumber)),
    ];
    const blocks = new Map<bigint, Date>();
    const tickerByToken = new Map<string, string>();
    const decimalsByToken = new Map<string, number>();
    const outputTokens = [
      ...new Map(
        [...strategies.values()].map((strategy) => [
          strategy[3].toLowerCase(),
          strategy[3],
        ]),
      ).values(),
    ];
    await Promise.all([
      Promise.all(
        blockNumbers.map(async (blockNumber) => {
          const block = await client.getBlock({ blockNumber });
          blocks.set(
            blockNumber,
            new Date(Number(block.timestamp) * 1_000),
          );
        }),
      ),
      Promise.allSettled(
        outputTokens.map(async (token) => {
          const decimals = await client.readContract({
            address: token,
            abi: tokenDecimalsAbi,
            functionName: "decimals",
          });
          decimalsByToken.set(token.toLowerCase(), decimals);
        }),
      ),
      this.catalog
        ?.catalog()
        .then((catalog) => {
          for (const asset of catalog.assets) {
            tickerByToken.set(
              asset.tokenAddress.toLowerCase(),
              asset.ticker,
            );
          }
        })
        .catch(() => undefined),
    ]);

    const entries = logs.flatMap((log) => {
      const strategyId = String(log.args.strategyId);
      const strategy = strategies.get(strategyId);
      if (
        !strategy ||
        getAddress(strategy[0]) !== getAddress(owner) ||
        log.args.nonce === undefined ||
        log.args.signalHash === undefined ||
        log.args.quoteHash === undefined ||
        log.args.amountIn === undefined ||
        log.args.amountOut === undefined ||
        log.args.router === undefined
      ) {
        return [];
      }
      const outputToken = strategy[3] as EvmAddress;
      return [
        {
          id: `${log.transactionHash}:${log.logIndex}`,
          status: "executed" as const,
          strategyId,
          nonce: String(log.args.nonce),
          ticker: tickerByToken.get(outputToken.toLowerCase()),
          inputToken: strategy[2] as EvmAddress,
          outputToken,
          outputDecimals: decimalsByToken.get(outputToken.toLowerCase()),
          amountIn: String(log.args.amountIn),
          amountOut: String(log.args.amountOut),
          router: log.args.router as EvmAddress,
          signalHash: log.args.signalHash,
          quoteHash: log.args.quoteHash,
          transactionHash: log.transactionHash,
          blockNumber: String(log.blockNumber),
          executedAt:
            blocks.get(log.blockNumber)?.toISOString() ??
            new Date(0).toISOString(),
        },
      ];
    });
    entries.sort((left, right) =>
      BigInt(left.blockNumber) < BigInt(right.blockNumber) ? 1 : -1,
    );
    return {
      source: "robinhood-chain",
      status: "ready",
      vault,
      entries,
    };
  }
}
