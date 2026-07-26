import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { EnsControlPlane } from "./ens-types.js";
import type { StockCatalogAsset } from "./market-types.js";
import { OpportunityAnalysisService } from "./opportunity-analysis.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;
const now = new Date("2026-07-25T12:00:00.000Z");

describe("opportunity analysis", () => {
  it("ranks policy-compatible routes and seals the comparison", async () => {
    const assets = new Map([
      ["NVDA", asset("NVDA", 90, 100_000)],
      ["AMZN", asset("AMZN", 20, 250_000)],
      ["AMD", asset("AMD", 150, 20_000)],
    ]);
    const service = createService({
      catalog: {
        assessTicker: async (ticker) => assets.get(ticker),
      },
    });

    const result = await service.analyze(input());

    expect(result.recommendedTicker).toBe("AMZN");
    expect(result.candidates.map((candidate) => candidate.ticker)).toEqual([
      "AMZN",
      "NVDA",
      "AMD",
    ]);
    expect(result.candidates[0]).toMatchObject({
      status: "recommended",
      orchestrationReady: true,
    });
    expect(result.candidates[2]).toMatchObject({
      status: "rejected",
      reason: "Indexed liquidity is below $50000",
    });
    expect(result.policy).toMatchObject({
      source: "durin",
      rootName: "u-12345678.demo.eth",
      version: 7,
    });
    expect(result.candidates[0]?.graphEvidence).toMatchObject({
      blockNumber: "1000",
      transactionHash: `0x${"33".repeat(32)}`,
      liquidityUsd: 250_000,
    });
    expect(result.candidates[0]?.uniswapRouting).toBe("V4");
    expect(result.proofRoot).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("applies the ENS pause and budget before market calls", async () => {
    let calls = 0;
    const service = createService({
      catalog: {
        assessTicker: async () => {
          calls += 1;
          return asset("NVDA", 20, 250_000);
        },
      },
      controlPlane: {
        resolve: async () => controlPlane({ paused: true }),
      },
    });

    const paused = await service.analyze(input());

    expect(calls).toBe(0);
    expect(paused.recommendedTicker).toBeUndefined();
    expect(
      paused.candidates.every(
        (candidate) =>
          candidate.status === "rejected" &&
          candidate.reason.includes("paused all fleet activity"),
      ),
    ).toBe(true);

    const budgetService = createService({
      catalog: {
        assessTicker: async () => {
          calls += 1;
          return asset("NVDA", 20, 250_000);
        },
      },
    });
    const overBudget = await budgetService.analyze({
      ...input(),
      amountIn: "1000001",
    });
    expect(calls).toBe(0);
    expect(overBudget.candidates[0]?.reason).toContain(
      "exceeds the ENS maximum",
    );
  });

  it("rejects unavailable ENS policy and disallowed tickers", async () => {
    const unavailable = createService({
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "unavailable",
          resolvedAt: now.toISOString(),
          error: "fleet is missing",
        }),
      },
    });
    await expect(unavailable.analyze(input())).rejects.toThrow(
      "fleet is missing",
    );

    const service = createService();
    await expect(
      service.analyze({
        ...input(),
        candidateTickers: ["TSLA"],
      }),
    ).rejects.toThrow("No requested ticker is allowed");
  });
});

function createService(
  dependencies: ConstructorParameters<
    typeof OpportunityAnalysisService
  >[1] = {},
) {
  return new OpportunityAnalysisService(loadConfig({}), {
    catalog: {
      assessTicker: async (ticker) => asset(ticker, 20, 250_000),
    },
    controlPlane: {
      resolve: async () => controlPlane(),
    },
    now: () => now,
    id: () => "analysis-1",
    ...dependencies,
  });
}

function input() {
  return {
    goal: "Find the strongest policy-compatible stock-token route",
    amountIn: "1000000",
    maxCandidates: 3,
    userId: "u-12345678",
    owner,
  };
}

function controlPlane(
  changes: { paused?: boolean } = {},
): EnsControlPlane {
  return {
    source: "durin",
    mode: "live",
    status: "active",
    rootName: "u-12345678.demo.eth",
    manifestHash: `0x${"aa".repeat(32)}`,
    resolvedAt: now.toISOString(),
    owner,
    manifest: {
      schema: "urn:eqlty:ens-orchestration:v1",
      version: 7,
      network: "eip155:4663",
      updatedAt: now.toISOString(),
      expiresAt: "2026-07-26T12:00:00.000Z",
      paused: changes.paused ?? false,
      fleet: {
        scout: "scout.u-12345678.demo.eth",
        risk: "risk.u-12345678.demo.eth",
        trader: "trader.u-12345678.demo.eth",
        auditor: "auditor.u-12345678.demo.eth",
      },
      policy: {
        allowedTickers: ["NVDA", "AMZN", "AMD"],
        maxAmountPerTrade: "1000000",
        maxDeviationBps: 300,
        minLiquidityUsd: 50_000,
        maxOracleAgeSeconds: 300,
      },
    },
  };
}

function asset(
  ticker: string,
  deviationBps: number,
  liquidityUsd: number,
): StockCatalogAsset {
  return {
    ticker,
    name: `${ticker} stock token`,
    tokenAddress: "0x2222222222222222222222222222222222222222",
    multiplier: "1",
    robinhoodStatus: "ACTIVE",
    tradability: "TRADABLE",
    priceSource: "robinhood-price-api",
    referencePrice: 100,
    referenceUpdatedAt: "2026-07-25T11:59:30.000Z",
    uniswapRoutable: true,
    uniswapRouting: "V4",
    uniswapRequestId: `quote-${ticker}`,
    quotedAmountIn: "1000000",
    quotedAmountOut: "10000000000000000",
    uniswapImpliedPrice: 100 + deviationBps / 100,
    deviationBps,
    graphEvidence: {
      source: "the-graph-substreams",
      healthy: true,
      protocol: "v4",
      blockNumber: "1000",
      liquidityUsd,
      lastSwapPrice: 100,
      poolAddress:
        "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      poolIdentifier: `0x${"22".repeat(32)}`,
      transactionHash: `0x${"33".repeat(32)}`,
      topic: `0x${"44".repeat(32)}`,
      capturedAt: "2026-07-25T11:59:30.000Z",
      processedBlock: "1000",
      providerHeadBlock: "1002",
      lagBlocks: 2,
      reasons: [],
    },
    status: "available",
    reasons: [],
    orchestrationReady: true,
  };
}
