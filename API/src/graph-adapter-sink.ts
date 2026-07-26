import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { GraphAdapterConfig } from "./graph-adapter-config.js";
import {
  decodeGraphSwap,
  type GraphPool,
  type GraphStreamEvent,
  type GraphSwapEvidence,
} from "./graph-adapter-decode.js";

const swapTopic =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const moduleName = "map_pool_events";
const packageName = "eqlty_robinhood_stock_v4@v0.1.0";
const maxSeriesPoints = 64;

type StreamRecord = {
  "@module": string;
  "@data"?: {
    blockNumber?: string;
    blockTimestampSeconds?: string;
    events?: GraphStreamEvent[];
  };
};

export class GraphAdapterSink {
  private child?: ChildProcess;
  private buffer = "";
  private startedAt = new Date().toISOString();
  private updatedAt = this.startedAt;
  private processedBlock = "0";
  private providerHeadBlock = "0";
  private restart?: NodeJS.Timeout;
  private headTimer?: NodeJS.Timeout;
  private stopped = false;
  private lastError?: string;
  private pools = new Map<string, GraphPool>();
  private poolManager = "";
  private evidenceByTicker = new Map<string, GraphSwapEvidence>();
  private seriesByTicker = new Map<string, GraphSwapEvidence[]>();

  constructor(private readonly config: GraphAdapterConfig) {}

  async start(): Promise<void> {
    const registry = JSON.parse(
      await readFile(this.config.EQLTY_GRAPH_POOL_REGISTRY_PATH, "utf8"),
    ) as {
      poolManager: string;
      assets: Record<string, { tokenAddress: string; poolId: string }>;
    };
    this.poolManager = registry.poolManager;
    this.pools = new Map(
      Object.entries(registry.assets).map(([ticker, pool]) => [
        ticker,
        { ticker, ...pool },
      ]),
    );
    this.stopped = false;
    await this.refreshHead();
    this.spawnStream();
    this.headTimer = setInterval(() => void this.refreshHead(), 10_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.restart) clearTimeout(this.restart);
    if (this.headTimer) clearInterval(this.headTimer);
    this.child?.kill("SIGTERM");
  }

  snapshot(ticker: string) {
    const evidence = this.evidenceByTicker.get(ticker.toUpperCase());
    if (!evidence) return undefined;
    const now = Date.now();
    const heartbeatAgeSeconds = ageSeconds(now, this.updatedAt);
    const swapAgeSeconds = ageSeconds(now, evidence.capturedAt);
    const lagBlocks = blockLag(
      this.providerHeadBlock,
      this.processedBlock,
    );
    const reasons: string[] = [];
    if (
      heartbeatAgeSeconds >
      this.config.EQLTY_GRAPH_MAX_PROVIDER_AGE_SECONDS
    ) {
      reasons.push(`provider heartbeat is ${Math.round(heartbeatAgeSeconds)}s old`);
    }
    if (swapAgeSeconds > this.config.EQLTY_GRAPH_MAX_SWAP_AGE_SECONDS) {
      reasons.push(`last swap is ${Math.round(swapAgeSeconds)}s old`);
    }
    if (this.lastError) reasons.push(this.lastError);
    return {
      ...evidence,
      stream: {
        mode: "live",
        provider: this.config.EQLTY_GRAPH_PROVIDER,
        package: packageName,
        module: moduleName,
        startedAt: this.startedAt,
        updatedAt: this.updatedAt,
        checkpointBlock: this.processedBlock,
        processedBlock: this.processedBlock,
        providerHeadBlock: this.providerHeadBlock,
        lagBlocks,
      },
      health: {
        healthy: reasons.length === 0,
        heartbeatAgeSeconds,
        swapAgeSeconds,
        reasons,
      },
    };
  }

  series(tickers: string[]) {
    return {
      source: "the-graph-substreams" as const,
      chainId: "eip155:4663" as const,
      observedAt: this.updatedAt,
      stream: {
        mode: "live" as const,
        provider: this.config.EQLTY_GRAPH_PROVIDER,
        package: packageName,
        module: moduleName,
        processedBlock: this.processedBlock,
        providerHeadBlock: this.providerHeadBlock,
        lagBlocks: blockLag(
          this.providerHeadBlock,
          this.processedBlock,
        ),
      },
      series: tickers.map((ticker) => ({
        ticker,
        points: (this.seriesByTicker.get(ticker) ?? []).map(
          (evidence) => ({
            at: evidence.capturedAt,
            price: evidence.lastSwapPrice,
            blockNumber: evidence.blockNumber,
            transactionHash: evidence.transactionHash,
            poolIdentifier: evidence.poolIdentifier,
          }),
        ),
      })),
    };
  }

  status() {
    return {
      running: Boolean(this.child),
      processedBlock: this.processedBlock,
      providerHeadBlock: this.providerHeadBlock,
      tickers: this.evidenceByTicker.size,
      lastError: this.lastError,
    };
  }

  private spawnStream(): void {
    const params = [...this.pools.values()]
      .map((pool) => `${pool.poolId.toLowerCase()}=${pool.ticker}`)
      .join(",");
    const child = spawn(
      "substreams",
      [
        "run",
        "-e",
        this.config.EQLTY_GRAPH_PROVIDER,
        this.config.EQLTY_GRAPH_PACKAGE_PATH,
        moduleName,
        "--start-block",
        `-${this.config.EQLTY_GRAPH_LOOKBACK_BLOCKS}`,
        "--stop-block",
        "0",
        "--output",
        "jsonl",
        "--params",
        `${moduleName}=v3=;v4=${this.poolManager.toLowerCase()}:${params}`,
        "--production-mode",
        "--max-retries",
        "-1",
        "--limit-processed-blocks",
        "0",
      ],
      {
        env: {
          ...process.env,
          SUBSTREAMS_API_TOKEN: this.config.EQLTY_GRAPH_API_TOKEN,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.consume(chunk));
    child.stderr!.on("data", (chunk: string) => {
      const line = chunk.trim().split("\n").at(-1);
      if (line && !line.startsWith("📊")) this.lastError = line.slice(0, 240);
    });
    child.once("error", (error) => {
      this.lastError = error.message;
    });
    child.once("close", () => {
      this.child = undefined;
      if (!this.stopped) {
        this.restart = setTimeout(() => this.spawnStream(), 2_000);
      }
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const record = JSON.parse(line) as StreamRecord;
        if (record["@module"] !== moduleName || !record["@data"]?.blockNumber) {
          continue;
        }
        this.update(record["@data"]);
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message.slice(0, 240) : "invalid output";
      }
    }
  }

  private update(data: NonNullable<StreamRecord["@data"]>): void {
    const blockNumber = data.blockNumber!;
    const capturedAt = new Date(
      Number(data.blockTimestampSeconds) * 1_000,
    ).toISOString();
    this.processedBlock = blockNumber;
    this.updatedAt = new Date().toISOString();
    this.lastError = undefined;
    for (const event of data.events ?? []) {
      const pool = this.pools.get(event.ticker);
      if (!pool || event.topics[0]?.toLowerCase() !== swapTopic) continue;
      const evidence = decodeGraphSwap(
        pool,
        event,
        blockNumber,
        capturedAt,
        this.poolManager,
      );
      this.evidenceByTicker.set(pool.ticker, evidence);
      const series = this.seriesByTicker.get(pool.ticker) ?? [];
      if (
        !series.some(
          (point) =>
            point.transactionHash === evidence.transactionHash &&
            point.blockNumber === evidence.blockNumber,
        )
      ) {
        series.push(evidence);
        this.seriesByTicker.set(
          pool.ticker,
          series.slice(-maxSeriesPoints),
        );
      }
    }
  }

  private async refreshHead(): Promise<void> {
    try {
      const response = await fetch(this.config.EQLTY_GRAPH_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as { result?: string };
      if (!body.result) throw new Error("RPC did not return a block number");
      this.providerHeadBlock = BigInt(body.result).toString();
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message.slice(0, 240) : "RPC failed";
    }
  }
}

function ageSeconds(now: number, timestamp: string): number {
  return Math.max(0, (now - Date.parse(timestamp)) / 1_000);
}

function blockLag(head: string, processed: string): number {
  const lag = BigInt(head) - BigInt(processed);
  return Number(lag > 0n ? lag : 0n);
}
