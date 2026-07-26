import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { GraphEvidenceService } from "./graph-evidence.js";

const now = Date.parse("2026-07-25T12:00:00.000Z");

describe("The Graph evidence", () => {
  it("authenticates the request and reevaluates stream health", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(providerEvidence()),
    );
    const service = new GraphEvidenceService(config(), {
      fetchFn,
      now: () => now,
    });

    const evidence = await service.evidence("nvda");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://graph.example/risk",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization:
            "Bearer eqlty-graph-access-token-for-tests",
        }),
        body: JSON.stringify({
          ticker: "NVDA",
          chainId: "eip155:4663",
        }),
      }),
    );
    expect(evidence.health).toEqual({
      healthy: true,
      heartbeatAgeSeconds: 10,
      swapAgeSeconds: 30,
      reasons: [],
    });
    expect(evidence.evaluatedAt).toBe("2026-07-25T12:00:00.000Z");
  });

  it("marks stale or lagging evidence unhealthy", async () => {
    const body = providerEvidence();
    body.stream.updatedAt = "2026-07-25T11:55:00.000Z";
    body.stream.lagBlocks = 50;
    const service = new GraphEvidenceService(config(), {
      fetchFn: async () => Response.json(body),
      now: () => now,
    });

    const evidence = await service.evidence("NVDA");

    expect(evidence.health.healthy).toBe(false);
    expect(evidence.health.reasons).toEqual([
      "provider heartbeat is 300s old",
      "provider lag is 50 blocks",
    ]);
  });

  it("loads auditable price points from the Substreams adapter", async () => {
    const fetchFn = vi.fn(async () => Response.json(providerSeries()));
    const service = new GraphEvidenceService(
      loadConfig({
        EQLTY_GRAPH_ADAPTER_URL:
          "https://graph.example/api/graph-risk",
        EQLTY_GRAPH_ACCESS_TOKEN:
          "eqlty-graph-access-token-for-tests",
      }),
      { fetchFn },
    );

    const result = await service.series(["nvda", "AMZN", "NVDA"]);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://graph.example/api/graph-series",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tickers: ["NVDA", "AMZN"] }),
      }),
    );
    expect(result.series[0]?.points[0]).toMatchObject({
      price: 180.5,
      blockNumber: "1000",
      transactionHash: `0x${"33".repeat(32)}`,
    });
  });

  it("rejects a ticker mismatch and oversized payload", async () => {
    const wrongTicker = providerEvidence();
    wrongTicker.ticker = "AMZN";
    const mismatch = new GraphEvidenceService(config(), {
      fetchFn: async () => Response.json(wrongTicker),
    });
    await expect(mismatch.evidence("NVDA")).rejects.toThrow(
      "returned AMZN",
    );

    const oversized = new GraphEvidenceService(config(), {
      fetchFn: async () =>
        new Response("{}", {
          headers: { "content-length": "262145" },
        }),
    });
    await expect(oversized.evidence("NVDA")).rejects.toThrow(
      "too large",
    );
  });
});

function config() {
  return loadConfig({
    GRAPH_RISK_URL: "https://graph.example/risk",
    EQLTY_GRAPH_ACCESS_TOKEN:
      "eqlty-graph-access-token-for-tests",
    GRAPH_API_TOKEN: "graph-token",
    GRAPH_MAX_PROVIDER_AGE_SECONDS: "90",
    GRAPH_MAX_SWAP_AGE_SECONDS: "3600",
    GRAPH_MAX_LAG_BLOCKS: "25",
  });
}

function providerEvidence() {
  return {
    source: "the-graph-substreams" as const,
    ticker: "NVDA",
    chainId: "eip155:4663" as const,
    protocol: "v4" as const,
    blockNumber: "1000",
    liquidityUsd: 250_000,
    lastSwapPrice: 180.5,
    poolAddress: "0x1111111111111111111111111111111111111111",
    poolIdentifier: `0x${"22".repeat(32)}`,
    transactionHash: `0x${"33".repeat(32)}`,
    topic: `0x${"44".repeat(32)}`,
    capturedAt: "2026-07-25T11:59:30.000Z",
    stream: {
      mode: "live" as const,
      provider: "robinhood.substreams.pinax.network:443",
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
      reasons: [] as string[],
    },
  };
}

function providerSeries() {
  return {
    source: "the-graph-substreams" as const,
    chainId: "eip155:4663" as const,
    observedAt: "2026-07-25T12:00:00.000Z",
    stream: {
      mode: "live" as const,
      provider: "robinhood.substreams.pinax.network:443",
      package: "eqlty_robinhood_stock_v4@v0.1.0",
      module: "map_pool_events" as const,
      processedBlock: "1000",
      providerHeadBlock: "1002",
      lagBlocks: 2,
    },
    series: [
      {
        ticker: "NVDA",
        points: [
          {
            at: "2026-07-25T11:59:30.000Z",
            price: 180.5,
            blockNumber: "1000",
            transactionHash: `0x${"33".repeat(32)}`,
            poolIdentifier: `0x${"22".repeat(32)}`,
          },
        ],
      },
    ],
  };
}
