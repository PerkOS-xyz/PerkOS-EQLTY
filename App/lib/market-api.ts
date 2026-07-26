import type { StockCatalog } from "./market-types";

export type MarketSeriesPoint = {
  at: string;
  price: number;
  blockNumber: string;
  transactionHash: `0x${string}`;
  poolIdentifier: string;
};

export type MarketSeriesResponse = {
  source: "the-graph-substreams";
  chainId: "eip155:4663";
  observedAt: string;
  stream: {
    mode: "live";
    provider: string;
    package: string;
    module: "map_pool_events";
    processedBlock: string;
    providerHeadBlock: string;
    lagBlocks: number;
  };
  series: Array<{
    ticker: string;
    points: MarketSeriesPoint[];
  }>;
};

const fallbackUrl = "http://localhost:4021";

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

function isStockCatalog(value: unknown): value is StockCatalog {
  if (!value || typeof value !== "object") {
    return false;
  }
  const catalog = value as Partial<StockCatalog>;
  return (
    catalog.chainId === 4663 &&
    catalog.quoteToken === "USDG" &&
    typeof catalog.observedAt === "string" &&
    Array.isArray(catalog.assets) &&
    Boolean(catalog.summary)
  );
}

export async function loadStockCatalog(
  refresh = false,
  signal?: AbortSignal,
): Promise<StockCatalog> {
  const query = refresh ? "&refresh=true" : "";
  const response = await fetch(
    `${apiUrl()}/api/assets?catalog=uniswap-v4-universe${query}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
      },
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Market request failed with status ${response.status}`;
    throw new Error(message);
  }
  if (!isStockCatalog(body)) {
    throw new Error("The market response is incomplete");
  }
  return body;
}

export async function loadStockSeries(
  tickers: string[],
  signal?: AbortSignal,
): Promise<MarketSeriesResponse> {
  const normalized = [...new Set(tickers.map((ticker) => ticker.toUpperCase()))];
  if (normalized.length === 0) {
    throw new Error("At least one stock ticker is required");
  }
  const chunks = Array.from(
    { length: Math.ceil(normalized.length / 20) },
    (_, index) => normalized.slice(index * 20, index * 20 + 20),
  );
  const responses = await Promise.all(
    chunks.map((chunk) => loadSeriesChunk(chunk, signal)),
  );
  const latest = responses.at(-1)!;
  return {
    ...latest,
    series: responses.flatMap((response) => response.series),
  };
}

async function loadSeriesChunk(
  tickers: string[],
  signal?: AbortSignal,
): Promise<MarketSeriesResponse> {
  const query = encodeURIComponent(tickers.join(","));
  const response = await fetch(`${apiUrl()}/api/assets/series?tickers=${query}`, {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `The Graph series request failed with status ${response.status}`,
    );
  }
  if (!isMarketSeries(body)) {
    throw new Error("The Graph series response is incomplete");
  }
  return body;
}

function isMarketSeries(value: unknown): value is MarketSeriesResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<MarketSeriesResponse>;
  return (
    result.source === "the-graph-substreams" &&
    result.chainId === "eip155:4663" &&
    typeof result.observedAt === "string" &&
    Array.isArray(result.series) &&
    result.series.every(
      (entry) =>
        entry &&
        typeof entry.ticker === "string" &&
        Array.isArray(entry.points) &&
        entry.points.every(
          (point) =>
            typeof point.at === "string" &&
            typeof point.price === "number" &&
            Number.isFinite(point.price) &&
            point.price > 0 &&
            typeof point.blockNumber === "string" &&
            /^0x[0-9a-fA-F]{64}$/.test(point.transactionHash),
        ),
    )
  );
}
