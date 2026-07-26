import { z } from "zod";
import type { ApiConfig } from "./config.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const graphEvidenceProviderSchema = z
  .object({
    source: z.literal("the-graph-substreams"),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
    chainId: z.literal("eip155:4663"),
    protocol: z.enum(["v3", "v4"]),
    blockNumber: z.string().regex(/^\d+$/),
    liquidityUsd: z.number().finite().positive(),
    lastSwapPrice: z.number().finite().positive(),
    poolAddress: address,
    poolIdentifier: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/),
    transactionHash: hex32,
    topic: hex32,
    capturedAt: z.string().datetime(),
    stream: z
      .object({
        mode: z.literal("live"),
        provider: z.string().min(1).max(256),
        package: z.string().min(1).max(256),
        module: z.literal("map_pool_events"),
        startedAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        checkpointBlock: z.string().regex(/^\d+$/),
        processedBlock: z.string().regex(/^\d+$/),
        providerHeadBlock: z.string().regex(/^\d+$/),
        lagBlocks: z.number().int().nonnegative(),
      })
      .strict(),
    health: z
      .object({
        healthy: z.boolean(),
        heartbeatAgeSeconds: z.number().finite().nonnegative(),
        swapAgeSeconds: z.number().finite().nonnegative(),
        reasons: z.array(z.string().min(1).max(256)).max(12),
      })
      .strict(),
  })
  .strict();

export type GraphProviderEvidence = z.infer<
  typeof graphEvidenceProviderSchema
>;

export type GraphEvidence = Omit<GraphProviderEvidence, "health"> & {
  evaluatedAt: string;
  health: GraphProviderEvidence["health"];
};

const graphSeriesSchema = z
  .object({
    source: z.literal("the-graph-substreams"),
    chainId: z.literal("eip155:4663"),
    observedAt: z.string().datetime(),
    stream: z
      .object({
        mode: z.literal("live"),
        provider: z.string().min(1).max(256),
        package: z.string().min(1).max(256),
        module: z.literal("map_pool_events"),
        processedBlock: z.string().regex(/^\d+$/),
        providerHeadBlock: z.string().regex(/^\d+$/),
        lagBlocks: z.number().int().nonnegative(),
      })
      .strict(),
    series: z
      .array(
        z
          .object({
            ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
            points: z
              .array(
                z
                  .object({
                    at: z.string().datetime(),
                    price: z.number().finite().positive(),
                    blockNumber: z.string().regex(/^\d+$/),
                    transactionHash: hex32,
                    poolIdentifier: z
                      .string()
                      .regex(
                        /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/,
                      ),
                  })
                  .strict(),
              )
              .max(64),
          })
          .strict(),
      )
      .max(96),
  })
  .strict();

export type GraphPriceSeries = z.infer<typeof graphSeriesSchema>;

type Dependencies = {
  fetchFn?: typeof fetch;
  now?: () => number;
};

export class GraphEvidenceService {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  ready(): boolean {
    return Boolean(
      this.config.EQLTY_GRAPH_ADAPTER_URL ?? this.config.GRAPH_RISK_URL,
    );
  }

  async evidence(ticker: string): Promise<GraphEvidence> {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(normalizedTicker)) {
      throw new Error("Ticker is invalid");
    }
    const adapterUrl =
      this.config.EQLTY_GRAPH_ADAPTER_URL ?? this.config.GRAPH_RISK_URL;
    if (!adapterUrl) {
      throw new Error("The Graph evidence provider is not configured");
    }
    const accessToken =
      this.config.EQLTY_GRAPH_ACCESS_TOKEN ??
      this.config.GRAPH_API_TOKEN;
    const response = await this.fetchFn(adapterUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(accessToken
          ? {
              authorization: `Bearer ${accessToken}`,
            }
          : {}),
      },
      body: JSON.stringify({
        ticker: normalizedTicker,
        chainId: "eip155:4663",
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(
        `The Graph evidence provider failed with status ${response.status}`,
      );
    }
    const body = graphEvidenceProviderSchema.parse(
      await limitedJson(response),
    );
    if (body.ticker !== normalizedTicker) {
      throw new Error(
        `The Graph returned ${body.ticker}, expected ${normalizedTicker}`,
      );
    }

    const evaluatedAt = new Date(this.now()).toISOString();
    const heartbeatAgeSeconds = ageSeconds(
      this.now(),
      body.stream.updatedAt,
    );
    const swapAgeSeconds = ageSeconds(this.now(), body.capturedAt);
    const reasons = new Set(body.health.reasons);
    if (!body.health.healthy && reasons.size === 0) {
      reasons.add("provider marked the stream unhealthy");
    }
    if (
      heartbeatAgeSeconds >
      this.config.GRAPH_MAX_PROVIDER_AGE_SECONDS
    ) {
      reasons.add(
        `provider heartbeat is ${Math.round(heartbeatAgeSeconds)}s old`,
      );
    }
    if (swapAgeSeconds > this.config.GRAPH_MAX_SWAP_AGE_SECONDS) {
      reasons.add(`last swap is ${Math.round(swapAgeSeconds)}s old`);
    }
    if (body.stream.lagBlocks > this.config.GRAPH_MAX_LAG_BLOCKS) {
      reasons.add(`provider lag is ${body.stream.lagBlocks} blocks`);
    }

    return {
      ...body,
      evaluatedAt,
      health: {
        healthy: body.health.healthy && reasons.size === 0,
        heartbeatAgeSeconds,
        swapAgeSeconds,
        reasons: [...reasons],
      },
    };
  }

  async series(tickers: string[]): Promise<GraphPriceSeries> {
    const normalized = [
      ...new Set(tickers.map((ticker) => ticker.trim().toUpperCase())),
    ];
    if (
      normalized.length === 0 ||
      normalized.length > 96 ||
      normalized.some(
        (ticker) => !/^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker),
      )
    ) {
      throw new Error("Ticker list is invalid");
    }
    const configuredUrl =
      this.config.EQLTY_GRAPH_ADAPTER_URL ?? this.config.GRAPH_RISK_URL;
    if (!configuredUrl) {
      throw new Error("The Graph evidence provider is not configured");
    }
    const seriesUrl = configuredUrl.replace(
      /\/api\/graph-risk\/?$/,
      "/api/graph-series",
    );
    if (seriesUrl === configuredUrl) {
      throw new Error("The Graph series endpoint is not configured");
    }
    const accessToken =
      this.config.EQLTY_GRAPH_ACCESS_TOKEN ??
      this.config.GRAPH_API_TOKEN;
    const response = await this.fetchFn(seriesUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(accessToken
          ? { authorization: `Bearer ${accessToken}` }
          : {}),
      },
      body: JSON.stringify({ tickers: normalized }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(
        `The Graph series provider failed with status ${response.status}`,
      );
    }
    const result = graphSeriesSchema.parse(await limitedJson(response));
    const requested = new Set(normalized);
    if (result.series.some((entry) => !requested.has(entry.ticker))) {
      throw new Error("The Graph series returned an unexpected ticker");
    }
    return result;
  }
}

async function limitedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 262_144) {
    throw new Error("The Graph evidence response is too large");
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 262_144) {
    throw new Error("The Graph evidence response is too large");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("The Graph evidence response is not valid JSON");
  }
}

function ageSeconds(now: number, timestamp: string): number {
  return Math.max(0, (now - Date.parse(timestamp)) / 1_000);
}
