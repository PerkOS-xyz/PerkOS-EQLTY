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
      graph: healthyGraph(),
    });

    const asset = await service.assessTicker("amzn");

    expect(asset).toMatchObject({
      ticker: "AMZN",
      status: "available",
      uniswapRequestId: "quote-1",
      uniswapImpliedPrice: 100,
      deviationBps: 0,
      orchestrationReady: true,
      graphEvidence: {
        source: "the-graph-substreams",
        healthy: true,
        protocol: "v4",
      },
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
      graph: healthyGraph(),
    });

    const asset = await service.assessTicker("AMZN");

    expect(asset?.status).toBe("blocked");
    expect(asset?.orchestrationReady).toBe(false);
    expect(asset?.reasons).toContain("Fresh Uniswap quote failed");
  });

  it("blocks orchestration when Graph evidence is stale", async () => {
    const graph = healthyGraph();
    graph.evidence = vi.fn().mockResolvedValue({
      ...(await graph.evidence("AMZN")),
      health: {
        healthy: false,
        heartbeatAgeSeconds: 300,
        swapAgeSeconds: 30,
        reasons: ["provider heartbeat is 300s old"],
      },
    });
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
      graph,
    });

    const asset = await service.assessTicker("AMZN");

    expect(asset?.orchestrationReady).toBe(false);
    expect(asset?.reasons).toContain(
      "The Graph: provider heartbeat is 300s old",
    );
  });

  it("blocks a Graph swap price from an intermediate pool", async () => {
    const graph = healthyGraph();
    graph.evidence = vi.fn().mockResolvedValue({
      ...(await graph.evidence("AMZN")),
      lastSwapPrice: 50_000_000_000,
    });
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
      graph,
    });

    const asset = await service.assessTicker("AMZN");

    expect(asset?.orchestrationReady).toBe(false);
    expect(asset?.graphEvidence).toMatchObject({
      healthy: false,
    });
    expect(asset?.graphEvidence?.priceDeviationBps).toBeGreaterThan(
      1_000,
    );
    expect(asset?.reasons[0]).toContain(
      "The Graph: swap price differs",
    );
  });
});

function fixtureFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    return Response.json(url.endsWith("/assets") ? assets : prices);
  });
}

function healthyGraph() {
  return {
    ready: () => true,
    evidence: vi.fn(async (ticker: string) => ({
      source: "the-graph-substreams" as const,
      ticker,
      chainId: "eip155:4663" as const,
      protocol: "v4" as const,
      blockNumber: "1000",
      liquidityUsd: 250_000,
      lastSwapPrice: 100,
      poolAddress:
        "0x1111111111111111111111111111111111111111" as const,
      poolIdentifier: `0x${"22".repeat(32)}`,
      transactionHash: `0x${"33".repeat(32)}` as const,
      topic: `0x${"44".repeat(32)}`,
      capturedAt: "2026-07-25T11:59:30.000Z",
      evaluatedAt: "2026-07-25T12:00:00.000Z",
      stream: {
        mode: "live" as const,
        provider: "substreams.example",
        package: "eqlty_robinhood_stock_v4@v0.1.0",
        module: "map_pool_events" as const,
        startedAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T11:59:50.000Z",
        checkpointBlock: "1000",
        processedBlock: "1000",
        providerHeadBlock: "1002",
        lagBlocks: 2,
      },
      health: {
        healthy: true,
        heartbeatAgeSeconds: 10,
        swapAgeSeconds: 30,
        reasons: [],
      },
    })),
  };
}
