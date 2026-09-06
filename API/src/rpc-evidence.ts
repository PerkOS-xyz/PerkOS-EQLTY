import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  defineChain,
  http,
  parseAbiItem,
  type Hex,
} from "viem";
import type { ApiConfig } from "./config.js";
import {
  decodeGraphSwap,
  type GraphPool,
} from "./graph-adapter-decode.js";
import type {
  GraphEvidence,
  GraphIntegrationStatus,
  OnchainPriceSeries,
} from "./graph-evidence.js";

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

type RpcLog = {
  address: `0x${string}`;
  blockNumber: bigint | null;
  data: Hex;
  logIndex: number | null;
  topics: readonly Hex[];
  transactionHash: Hex | null;
};

type EvidenceRpcClient = {
  getBlock(input: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getBlockNumber(): Promise<bigint>;
  getChainId(): Promise<number>;
  getLogs(input: {
    address: `0x${string}`;
    args: { id: Hex };
    event: typeof swapEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<RpcLog[]>;
};

type PoolRegistry = {
  chainId: 4663;
  poolManager: `0x${string}`;
  assets: Record<string, GraphPool>;
};

type Dependencies = {
  client?: EvidenceRpcClient;
  now?: () => number;
  registry?: PoolRegistry;
};

export class RpcEvidenceService {
  private readonly client?: EvidenceRpcClient;
  private readonly now: () => number;
  private readonly registry: PoolRegistry;
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: GraphEvidence }
  >();
  private readonly pending = new Map<string, Promise<GraphEvidence>>();

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.registry = dependencies.registry ?? loadPoolRegistry();
    this.client =
      dependencies.client ??
      (config.ROBINHOOD_MAINNET_RPC_URL
        ? createRpcClient(config.ROBINHOOD_MAINNET_RPC_URL)
        : undefined);
  }

  ready(): boolean {
    return Boolean(this.client);
  }

  async status(): Promise<GraphIntegrationStatus> {
    const checkedAt = new Date(this.now()).toISOString();
    if (!this.client) {
      return {
        configured: false,
        status: "pending",
        checkedAt,
        evidenceProvider: "robinhood-rpc",
        reason: "not-configured",
        recovery: {
          state: "action-required",
          action: "configure-provider",
          automatic: false,
          message: "Configure the Robinhood Chain RPC before enabling decisions.",
        },
      };
    }
    try {
      const [chainId, head] = await Promise.all([
        this.client.getChainId(),
        this.client.getBlockNumber(),
      ]);
      if (chainId !== 4663) {
        throw new Error("RPC chain mismatch");
      }
      return {
        configured: true,
        status: "ready",
        checkedAt,
        evidenceProvider: "robinhood-rpc",
        providerName: rpcProviderName(
          this.config.ROBINHOOD_MAINNET_RPC_URL,
        ),
        running: true,
        processedBlock: head.toString(),
        providerHeadBlock: head.toString(),
        lagBlocks: 0,
        observedTickers: Object.keys(this.registry.assets).length,
        recovery: {
          state: "healthy",
          action: "none",
          automatic: true,
          message: "Robinhood Chain onchain evidence is reachable.",
          blocksRemaining: 0,
          syncPercent: 100,
        },
      };
    } catch {
      return {
        configured: true,
        status: "degraded",
        checkedAt,
        evidenceProvider: "robinhood-rpc",
        providerName: rpcProviderName(
          this.config.ROBINHOOD_MAINNET_RPC_URL,
        ),
        running: false,
        reason: "unreachable",
        recovery: {
          state: "action-required",
          action: "check-provider",
          automatic: false,
          message: "The Robinhood Chain RPC cannot supply current evidence.",
        },
      };
    }
  }

  async evidence(ticker: string): Promise<GraphEvidence> {
    const normalized = normalizeTicker(ticker);
    const cached = this.cache.get(normalized);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const inFlight = this.pending.get(normalized);
    if (inFlight) return inFlight;
    const request = this.readEvidence(normalized)
      .then((value) => {
        this.cache.set(normalized, {
          expiresAt:
            this.now() +
            this.config.EQLTY_RPC_EVIDENCE_CACHE_SECONDS * 1_000,
          value,
        });
        return value;
      })
      .finally(() => this.pending.delete(normalized));
    this.pending.set(normalized, request);
    return request;
  }

  async series(tickers: string[]): Promise<OnchainPriceSeries> {
    const normalized = [...new Set(tickers.map(normalizeTicker))];
    if (normalized.length === 0 || normalized.length > 96) {
      throw new Error("Ticker list is invalid");
    }
    const results = await Promise.allSettled(
      normalized.map((ticker) => this.evidence(ticker)),
    );
    const head = results
      .filter(
        (result): result is PromiseFulfilledResult<GraphEvidence> =>
          result.status === "fulfilled",
      )
      .at(-1)?.value.stream.providerHeadBlock ?? "0";
    return {
      source: "robinhood-rpc",
      chainId: "eip155:4663",
      observedAt: new Date(this.now()).toISOString(),
      stream: {
        mode: "live",
        provider: rpcProviderName(
          this.config.ROBINHOOD_MAINNET_RPC_URL,
        ),
        module: "eth_getLogs",
        processedBlock: head,
        providerHeadBlock: head,
        lagBlocks: 0,
      },
      series: results.flatMap((result, index) =>
        result.status === "fulfilled"
          ? [{
              ticker: normalized[index]!,
              points: [{
                at: result.value.capturedAt,
                price: result.value.lastSwapPrice,
                blockNumber: result.value.blockNumber,
                transactionHash: result.value.transactionHash,
                poolIdentifier: result.value.poolIdentifier,
              }],
            }]
          : [],
      ),
    };
  }

  private async readEvidence(ticker: string): Promise<GraphEvidence> {
    if (!this.client) {
      throw new Error("Robinhood RPC evidence is not configured");
    }
    const pool = this.registry.assets[ticker];
    if (!pool) throw new Error(`${ticker} has no registered Uniswap V4 pool`);
    const chainId = await this.client.getChainId();
    if (chainId !== this.registry.chainId) {
      throw new Error("Robinhood RPC returned an unexpected chain id");
    }
    const head = await this.client.getBlockNumber();
    const lookback = BigInt(this.config.EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS);
    const floor = head >= lookback ? head - lookback + 1n : 0n;
    const range = BigInt(this.config.EQLTY_RPC_EVIDENCE_BLOCK_RANGE);
    const log = await this.latestSwap(pool, floor, head, range);
    if (!log?.transactionHash || log.blockNumber === null) {
      throw new Error(
        `${ticker} has no recent onchain swap evidence in the configured window`,
      );
    }
    const block = await this.client.getBlock({
      blockNumber: log.blockNumber,
    });
    const capturedAt = new Date(Number(block.timestamp) * 1_000).toISOString();
    const decoded = decodeGraphSwap(
      pool,
      {
        address: log.address,
        topics: [...log.topics],
        transactionHash: log.transactionHash,
        data: log.data,
        ticker,
        poolIdentifier: pool.poolId,
        protocol: "v4",
      },
      log.blockNumber.toString(),
      capturedAt,
      this.registry.poolManager,
    );
    if (
      !Number.isFinite(decoded.lastSwapPrice) ||
      decoded.lastSwapPrice <= 0 ||
      !Number.isFinite(decoded.liquidityUsd) ||
      decoded.liquidityUsd <= 0
    ) {
      throw new Error(`${ticker} onchain swap evidence is invalid`);
    }
    const evaluatedAt = new Date(this.now()).toISOString();
    const swapAgeSeconds = Math.max(
      0,
      (this.now() - Date.parse(capturedAt)) / 1_000,
    );
    const reasons =
      swapAgeSeconds > this.config.GRAPH_MAX_SWAP_AGE_SECONDS
        ? [`last swap is ${Math.round(swapAgeSeconds)}s old`]
        : [];
    return {
      ...decoded,
      source: "robinhood-rpc",
      evaluatedAt,
      stream: {
        mode: "live",
        provider: rpcProviderName(
          this.config.ROBINHOOD_MAINNET_RPC_URL,
        ),
        module: "eth_getLogs",
        startedAt: evaluatedAt,
        updatedAt: evaluatedAt,
        checkpointBlock: head.toString(),
        processedBlock: head.toString(),
        providerHeadBlock: head.toString(),
        lagBlocks: 0,
      },
      health: {
        healthy: reasons.length === 0,
        heartbeatAgeSeconds: 0,
        swapAgeSeconds,
        reasons,
      },
    };
  }

  private async latestSwap(
    pool: GraphPool,
    floor: bigint,
    head: bigint,
    range: bigint,
  ): Promise<RpcLog | undefined> {
    let toBlock = head;
    while (toBlock >= floor) {
      const fromBlock =
        toBlock - floor + 1n > range ? toBlock - range + 1n : floor;
      const logs = await this.client!.getLogs({
        address: this.registry.poolManager,
        event: swapEvent,
        args: { id: pool.poolId as Hex },
        fromBlock,
        toBlock,
      });
      const latest = logs.sort(compareLogs).at(-1);
      if (latest) return latest;
      if (fromBlock === floor) break;
      toBlock = fromBlock - 1n;
    }
    return undefined;
  }
}

function createRpcClient(url: string): EvidenceRpcClient {
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  return createPublicClient({ chain, transport: http(url) }) as unknown as
    EvidenceRpcClient;
}

function loadPoolRegistry(): PoolRegistry {
  const path = fileURLToPath(
    new URL(
      "../../Plugins/EQLTY-The-Graph-Plugin/skills/robinhood-stock-substreams/assets/pool-registry.json",
      import.meta.url,
    ),
  );
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PoolRegistry>;
  if (
    parsed.chainId !== 4663 ||
    !isAddress(parsed.poolManager) ||
    !parsed.assets ||
    typeof parsed.assets !== "object"
  ) {
    throw new Error("The Robinhood pool registry is invalid");
  }
  const assets = Object.fromEntries(
    Object.entries(parsed.assets).flatMap(([ticker, pool]) =>
      /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) &&
      pool &&
      isAddress(pool.tokenAddress) &&
      /^0x[0-9a-fA-F]{64}$/.test(pool.poolId)
        ? [[ticker, {
            ticker,
            tokenAddress: pool.tokenAddress,
            poolId: pool.poolId,
          }]]
        : [],
    ),
  );
  if (Object.keys(assets).length === 0) {
    throw new Error("The Robinhood pool registry has no usable assets");
  }
  return {
    chainId: 4663,
    poolManager: parsed.poolManager,
    assets,
  };
}

function normalizeTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(normalized)) {
    throw new Error("Ticker is invalid");
  }
  return normalized;
}

function compareLogs(left: RpcLog, right: RpcLog): number {
  const block = (left.blockNumber ?? 0n) - (right.blockNumber ?? 0n);
  if (block !== 0n) return block > 0n ? 1 : -1;
  return (left.logIndex ?? 0) - (right.logIndex ?? 0);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function rpcProviderName(url?: string): string {
  if (!url) return "robinhood-json-rpc";
  try {
    return new URL(url).hostname;
  } catch {
    return "robinhood-json-rpc";
  }
}
