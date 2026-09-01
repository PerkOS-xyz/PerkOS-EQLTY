import { z } from "zod";
import type { ApiConfig } from "./config.js";

const sparklinePoint = z.object({
  timestampS: z.union([
    z.string().regex(/^[1-9]\d{0,15}$/),
    z.number().int().positive(),
  ]),
  value: z.number().finite().positive(),
});

const sparkline = z.object({
  points: z.array(sparklinePoint).max(96),
});

const chainToken = z.object({
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

const issuerToken = z.object({
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(160).optional(),
  issuer: z.string().min(1).max(80),
  priceUsd: z.number().finite().positive().optional(),
  priceChange24hPct: z.number().finite().optional(),
  volume24hUsd: z.number().finite().nonnegative().optional(),
  sparkline1d: sparkline.optional(),
  chainTokens: z.array(chainToken).max(32),
});

const rankedRwaResponse = z.object({
  rwas: z
    .array(
      z.object({
        symbol: z.string().min(1).max(24),
        name: z.string().min(1).max(160),
        priceUsd: z.number().finite().positive().optional(),
        priceChange24hPct: z.number().finite().optional(),
        volume24hUsd: z.number().finite().nonnegative().optional(),
        sparkline1d: sparkline.optional(),
        issuerTokens: z.array(issuerToken).max(32),
      }),
    )
    .max(500),
});

export type MarketDaySeries = {
  source: "uniswap-rwa-1d";
  chainId: 4663;
  observedAt: string;
  series: Array<{
    ticker: string;
    name: string;
    tokenAddress: `0x${string}`;
    priceUsd: number;
    priceChange24hPct?: number;
    volume24hUsd: number;
    points: Array<{
      at: string;
      value: number;
    }>;
  }>;
};

export type UniswapRwaCoverage = {
  source: "uniswap-rwa-market";
  chainId: 4663;
  observedAt: string;
  assets: Array<{
    ticker: string;
    tokenAddress: `0x${string}`;
  }>;
};

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
};

export class UniswapRwaMarketService {
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private cached?: {
    expiresAt: number;
    observedAt: string;
    value: z.infer<typeof rankedRwaResponse>;
  };

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetch = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async series(tickers: string[]): Promise<MarketDaySeries> {
    const requested = new Set(tickers.map((ticker) => ticker.toUpperCase()));
    const snapshot = await this.snapshot();
    return {
      source: "uniswap-rwa-1d",
      chainId: 4663,
      observedAt: snapshot.observedAt,
      series: this.marketSeries(snapshot.value).filter((entry) =>
        requested.has(entry.ticker),
      ),
    };
  }

  async coverage(): Promise<UniswapRwaCoverage> {
    const snapshot = await this.snapshot();
    return {
      source: "uniswap-rwa-market",
      chainId: 4663,
      observedAt: snapshot.observedAt,
      assets: snapshot.value.rwas.flatMap((rwa) => {
        const issuer = robinhoodIssuer(rwa.issuerTokens);
        const token = issuer?.chainTokens.find(
          (entry) => entry.chainId === 4663,
        );
        return issuer && token
          ? [
              {
                ticker: issuer.symbol.toUpperCase(),
                tokenAddress: token.address as `0x${string}`,
              },
            ]
          : [];
      }),
    };
  }

  private async snapshot(): Promise<{
    observedAt: string;
    value: z.infer<typeof rankedRwaResponse>;
  }> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now.getTime()) {
      return this.cached;
    }

    const response = await this.fetch(
      `${this.config.EQLTY_UNISWAP_RWA_URL}/data.v1.DataApiService/ListRankedRwas`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "connect-protocol-version": "1",
          "content-type": "application/json",
          "x-request-source": "eqlty",
        },
        body: JSON.stringify({
          category: "RWA_CATEGORY_STOCKS",
          chainIds: [4663],
          includeSparkline1d: true,
          useSubstreamData: true,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Uniswap RWA request failed with ${response.status}`);
    }
    const value = rankedRwaResponse.parse(await response.json());
    this.cached = {
      expiresAt: now.getTime() + 5 * 60 * 1_000,
      observedAt: now.toISOString(),
      value,
    };
    return this.cached;
  }

  private marketSeries(
    snapshot: z.infer<typeof rankedRwaResponse>,
  ): MarketDaySeries["series"] {
    return snapshot.rwas.flatMap((rwa) => {
      const issuer = robinhoodIssuer(rwa.issuerTokens);
      const token = issuer?.chainTokens.find(
        (entry) => entry.chainId === 4663,
      );
      if (!issuer || !token) {
        return [];
      }
      const sourceSparkline = issuer.sparkline1d ?? rwa.sparkline1d;
      const priceUsd = issuer.priceUsd ?? rwa.priceUsd;
      if (!sourceSparkline || !priceUsd) {
        return [];
      }
      const points = sourceSparkline.points
        .map((point) => ({
          at: new Date(Number(point.timestampS) * 1_000).toISOString(),
          value: point.value,
        }))
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
      if (points.length < 2) {
        return [];
      }
      return [
        {
          ticker: issuer.symbol.toUpperCase(),
          name: issuer.name || rwa.name,
          tokenAddress: token.address as `0x${string}`,
          priceUsd,
          priceChange24hPct:
            issuer.priceChange24hPct ?? rwa.priceChange24hPct,
          volume24hUsd: issuer.volume24hUsd ?? rwa.volume24hUsd ?? 0,
          points,
        },
      ];
    });
  }
}

function robinhoodIssuer(
  issuers: z.infer<typeof issuerToken>[],
): z.infer<typeof issuerToken> | undefined {
  return issuers.find(
    (entry) =>
      entry.issuer.toLowerCase() === "robinhood" &&
      entry.chainTokens.some((token) => token.chainId === 4663),
  );
}
