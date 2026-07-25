import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { StockCatalogService } from "./stock-catalog.js";

const now = Date.parse("2026-07-25T12:00:00.000Z");
const assets = {
  assets: [
    {
      tokenSymbol: "AMZN",
      tokenName: "Amazon",
      deployments: [
        {
          chainId: 4663,
          contractAddress: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
        },
      ],
      currentMultiplier: "1",
      status: "ASSET_STATUS_ACTIVE",
      tradingCapabilities: {
        market: { fractional: "TRADING_STATUS_TRADABLE" },
      },
    },
    {
      tokenSymbol: "CRWD",
      tokenName: "CrowdStrike",
      deployments: [
        {
          chainId: 4663,
          contractAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
      currentMultiplier: "1",
      status: "ASSET_STATUS_ACTIVE",
      tradingCapabilities: {
        market: { fractional: "TRADING_STATUS_TRADABLE" },
      },
    },
  ],
};
const prices = {
  quotes: [
    {
      tokenSymbol: "AMZN",
      ask: "100",
      generatedAt: "2026-07-25T11:59:30.000Z",
      isTradingHalt: false,
    },
    {
      tokenSymbol: "CRWD",
      ask: "400",
      generatedAt: "2026-07-25T11:59:30.000Z",
      isTradingHalt: false,
    },
  ],
};

describe("stock catalog", () => {
  it("combines Robinhood assets with observed V4 coverage", async () => {
    const fetchFn = fixtureFetch();
    const service = new StockCatalogService(loadConfig({}), {
      fetchFn,
      now: () => now,
    });

    const catalog = await service.catalog();

    expect(catalog.summary).toMatchObject({
      total: 2,
      available: 1,
      blocked: 1,
      routed: 1,
      orchestrationReady: 0,
    });
    expect(catalog.assets[0]).toMatchObject({
      ticker: "AMZN",
      status: "available",
      uniswapRoutable: true,
      orchestrationReady: false,
    });
    expect(catalog.assets[1]?.reasons).toContain(
      "No observed Uniswap V4 route",
    );
  });

  it("uses the one minute catalog cache", async () => {
    const fetchFn = fixtureFetch();
    const service = new StockCatalogService(loadConfig({}), {
      fetchFn,
      now: () => now,
    });

    await service.catalog();
    await service.catalog();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("requires a fresh Uniswap quote for orchestration", async () => {
    const service = new StockCatalogService(loadConfig({}), {
      fetchFn: fixtureFetch(),
      now: () => now,
      uniswap: {
        ready: () => true,
        quote: vi.fn().mockResolvedValue({
          amountOut: "10000000000000000",
          requestId: "quote-1",
          routing: "V4",
        }),
      },
    });

    const asset = await service.assessTicker("amzn");

    expect(asset).toMatchObject({
      ticker: "AMZN",
      status: "available",
      uniswapRequestId: "quote-1",
      uniswapImpliedPrice: 100,
      deviationBps: 0,
      orchestrationReady: true,
    });
  });

  it("blocks orchestration when a fresh quote fails", async () => {
    const service = new StockCatalogService(loadConfig({}), {
      fetchFn: fixtureFetch(),
      now: () => now,
      uniswap: {
        ready: () => true,
        quote: vi.fn().mockRejectedValue(new Error("unavailable")),
      },
    });

    const asset = await service.assessTicker("AMZN");

    expect(asset?.status).toBe("blocked");
    expect(asset?.orchestrationReady).toBe(false);
    expect(asset?.reasons).toContain("Fresh Uniswap quote failed");
  });
});

function fixtureFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    return Response.json(url.endsWith("/assets") ? assets : prices);
  });
}
