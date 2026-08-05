import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { GraphEvidenceService } from "./graph-evidence.js";

const now = Date.parse("2026-07-25T12:00:00.000Z");

describe("The Graph evidence", () => {
  it("reports live adapter readiness from its health endpoint", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        running: true,
        processedBlock: "1000",
        providerHeadBlock: "1002",
        tickers: 24,
      }),
    );
    const service = new GraphEvidenceService(config(), {
      fetchFn,
      now: () => now,
    });

    const status = await service.status();

    expect(fetchFn).toHaveBeenCalledWith(
      new URL("https://graph.example/health"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(status).toEqual({
      configured: true,
      status: "ready",
      checkedAt: "2026-07-25T12:00:00.000Z",
      running: true,
      processedBlock: "1000",
      providerHeadBlock: "1002",
      lagBlocks: 2,
      observedTickers: 24,
      recovery: {
        state: "healthy",
        action: "none",
        automatic: true,
        message: "Live Substreams evidence is synchronized.",
        blocksRemaining: 2,
        syncPercent: 99.8,
      },
    });
  });

  it("reports an exhausted Graph quota as degraded", async () => {
    const service = new GraphEvidenceService(config(), {
      fetchFn: async () =>
        Response.json(
          {
            running: false,
            processedBlock: "1000",
            providerHeadBlock: "2000",
            tickers: 0,
            lastError:
              "billable processed blocks quota exceeded",
          },
          { status: 503 },
        ),
      now: () => now,
    });

    await expect(service.status()).resolves.toMatchObject({
      configured: true,
      status: "degraded",
      running: false,
      lagBlocks: 1000,
      reason: "quota-exhausted",
      recovery: {
        state: "action-required",
        action: "renew-quota",
        automatic: false,
        blocksRemaining: 1000,
      },
    });
  });

  it("reports an unreachable configured adapter as degraded", async () => {
    const service = new GraphEvidenceService(config(), {
      fetchFn: async () => {
        throw new Error("offline");
      },
      now: () => now,
    });

    await expect(service.status()).resolves.toEqual({
      configured: true,
      status: "degraded",
      checkedAt: "2026-07-25T12:00:00.000Z",
      running: false,
      reason: "unreachable",
      recovery: {
        state: "action-required",
        action: "check-provider",
        automatic: false,
        message:
          "The provider cannot supply verified evidence. Check connectivity and credentials.",
      },
    });
  });

  it("exposes adapter recovery progress without leaking provider errors", async () => {
    const service = new GraphEvidenceService(config(), {
      fetchFn: async () =>
        Response.json(
          {
            running: false,
            state: "recovering",
            processedBlock: "1500",
            providerHeadBlock: "2000",
            tickers: 10,
            restartCount: 3,
            lastProgressAt: "2026-07-25T11:58:00.000Z",
            nextRetryAt: "2026-07-25T12:01:00.000Z",
            errorCode: "quota-exhausted",
            lastError: "private provider diagnostic",
          },
          { status: 503 },
        ),
      now: () => now,
    });

    const status = await service.status();

    expect(status).toMatchObject({
      adapterState: "recovering",
      lastProgressAt: "2026-07-25T11:58:00.000Z",
      restartCount: 3,
      reason: "quota-exhausted",
      recovery: {
        action: "renew-quota",
        blocksRemaining: 500,
        syncPercent: 75,
        nextRetryAt: "2026-07-25T12:01:00.000Z",
      },
    });
    expect(JSON.stringify(status)).not.toContain("private provider diagnostic");
  });

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
