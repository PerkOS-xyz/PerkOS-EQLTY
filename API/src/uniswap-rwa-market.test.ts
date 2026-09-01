import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { UniswapRwaMarketService } from "./uniswap-rwa-market.js";

describe("Uniswap RWA market", () => {
  it("returns the official Robinhood 1D series for requested tickers", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) =>
      new Response(JSON.stringify(fixture()), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const service = new UniswapRwaMarketService(loadConfig({}), {
      fetch: fetcher,
      now: () => new Date("2026-07-26T04:00:00.000Z"),
    });

    const first = await service.series(["NVDA"]);
    const second = await service.series(["AMZN"]);

    expect(first).toMatchObject({
      source: "uniswap-rwa-1d",
      chainId: 4663,
      observedAt: "2026-07-26T04:00:00.000Z",
      series: [
        {
          ticker: "NVDA",
          tokenAddress: "0x1111111111111111111111111111111111111111",
          priceUsd: 208.79,
          priceChange24hPct: 0.55,
          volume24hUsd: 6_875_502,
        },
      ],
    });
    expect(first.series[0]?.points).toEqual([
      { at: "2026-07-25T02:00:00.000Z", value: 206.69 },
      { at: "2026-07-25T03:00:00.000Z", value: 207.33 },
    ]);
    expect(second.series[0]?.ticker).toBe("AMZN");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        category: "RWA_CATEGORY_STOCKS",
        chainIds: [4663],
        includeSparkline1d: true,
        useSubstreamData: true,
      }),
    });
  });

  it("does not present another issuer as a Robinhood token", async () => {
    const response = fixture();
    response.rwas[0]!.issuerTokens[0]!.issuer = "other";
    const service = new UniswapRwaMarketService(loadConfig({}), {
      fetch: async () =>
        new Response(JSON.stringify(response), { status: 200 }),
    });

    const result = await service.series(["NVDA"]);

    expect(result.series).toEqual([]);
  });

  it("discovers Uniswap coverage without requiring chart history", async () => {
    const response = fixture();
    delete (response.rwas[0]!.issuerTokens[0]! as {
      sparkline1d?: unknown;
    }).sparkline1d;
    const service = new UniswapRwaMarketService(loadConfig({}), {
      fetch: async () => Response.json(response),
      now: () => new Date("2026-07-26T04:00:00.000Z"),
    });

    const coverage = await service.coverage();

    expect(coverage).toMatchObject({
      source: "uniswap-rwa-market",
      chainId: 4663,
      assets: [
        {
          ticker: "NVDA",
          tokenAddress: "0x1111111111111111111111111111111111111111",
        },
        {
          ticker: "AMZN",
          tokenAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
    });
    await expect(service.series(["NVDA"])).resolves.toMatchObject({
      series: [],
    });
  });
});

function fixture() {
  return {
    rwas: [
      {
        symbol: "NVDA",
        name: "Nvidia",
        issuerTokens: [
          {
            symbol: "NVDA",
            name: "Nvidia",
            issuer: "robinhood",
            priceUsd: 208.79,
            priceChange24hPct: 0.55,
            volume24hUsd: 6_875_502,
            sparkline1d: {
              points: [
                { timestampS: "1784944800", value: 206.69 },
                { timestampS: "1784948400", value: 207.33 },
              ],
            },
            chainTokens: [
              {
                chainId: 4663,
                address: "0x1111111111111111111111111111111111111111",
              },
            ],
          },
        ],
      },
      {
        symbol: "AMZN",
        name: "Amazon",
        issuerTokens: [
          {
            symbol: "AMZN",
            name: "Amazon",
            issuer: "robinhood",
            priceUsd: 225,
            volume24hUsd: 750_000,
            sparkline1d: {
              points: [
                { timestampS: "1784944800", value: 224 },
                { timestampS: "1784948400", value: 225 },
              ],
            },
            chainTokens: [
              {
                chainId: 4663,
                address: "0x2222222222222222222222222222222222222222",
              },
            ],
          },
        ],
      },
    ],
  };
}
