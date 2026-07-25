import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { EnsControlPlane } from "./ens-types.js";
import type { StockCatalogAsset } from "./market-types.js";
import { ProofRunService } from "./proof-run.js";
import { StrategyStore } from "./strategy-store.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;
const now = new Date("2026-07-25T12:00:00.000Z");

describe("proof runs", () => {
  it("seals the four-agent proof without moving funds", async () => {
    const { service, strategyId } = setup();

    const run = await service.run(runInput(strategyId));

    expect(run.status).toBe("approved");
    expect(run.executeRequested).toBe(false);
    expect(run.steps.map((step) => step.id)).toEqual([
      "strategy",
      "ens",
      "scout",
      "risk",
      "quote",
      "execute",
    ]);
    expect(run.handoffs.map((handoff) => handoff.kind)).toEqual([
      "fleet-policy",
      "paid-signal",
      "risk-decision",
      "execution-intent",
      "audit-bundle",
    ]);
    expect(run.market).toMatchObject({
      graphMode: "live",
      blockNumber: "1000",
      liquidityUsd: 250_000,
    });
    expect(run.quote).toMatchObject({
      routing: "V4",
      requestId: "quote-NVDA",
      mode: "live",
    });
    expect(run.proofBundleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(run.transactionHash).toBeUndefined();
  });

  it("stops immediately when the ENS emergency pause is active", async () => {
    const { service, strategyId } = setup({
      controlPlane: {
        resolve: async () => controlPlane(true),
      },
    });

    const run = await service.run(runInput(strategyId));

    expect(run.status).toBe("rejected");
    expect(run.rejectionReason).toBe("ENS fleet policy is paused");
    expect(run.steps.some((step) => step.status === "blocked")).toBe(true);
    expect(run.handoffs.at(-1)?.kind).toBe("audit-bundle");
  });

  it("does not execute with preview x401 and x402 evidence", async () => {
    const execute = vi.fn();
    const { service, strategyId } = setup({
      executor: {
        ready: () => true,
        execute,
      },
    });

    const run = await service.run({
      ...runInput(strategyId),
      execute: true,
      executionAuthorized: true,
    });

    expect(run.status).toBe("rejected");
    expect(run.rejectionReason).toContain("x401 and x402");
    expect(execute).not.toHaveBeenCalled();
    expect(run.transactionHash).toBeUndefined();
  });

  it("rejects stale or incomplete market evidence", async () => {
    const blocked = asset();
    blocked.orchestrationReady = false;
    blocked.reasons = ["The Graph provider heartbeat is stale"];
    const { service, strategyId } = setup({
      catalog: { assessTicker: async () => blocked },
    });

    const run = await service.run(runInput(strategyId));

    expect(run.status).toBe("rejected");
    expect(run.rejectionReason).toBe(
      "The Graph provider heartbeat is stale",
    );
  });
});

function setup(
  dependencies: ConstructorParameters<typeof ProofRunService>[2] = {},
) {
  const store = new StrategyStore({
    id: () => "strategy-1",
    now: () => now.getTime(),
  });
  const strategy = store.create({
    ticker: "NVDA",
    owner,
    agent: owner,
    inputToken:
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    outputToken:
      "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    router: "0x8876789976decbfcbbbe364623c63652db8c0904",
    maxAmountPerTrade: "1000000",
    maxTotalSpend: "1000000",
    maxSlippageBps: 100,
    expiresAt: "2026-07-26T12:00:00.000Z",
    executionMode: "full",
  });
  const service = new ProofRunService(loadConfig({}), store, {
    catalog: { assessTicker: async () => asset() },
    controlPlane: { resolve: async () => controlPlane() },
    now: () => now,
    id: () => "run-1",
    ...dependencies,
  });
  return { service, strategyId: strategy.id };
}

function runInput(strategyId: string) {
  return {
    strategyId,
    amountIn: "1000000",
    execute: false,
    userId: "u-12345678",
    owner,
    executionAuthorized: false,
  };
}

function controlPlane(paused = false): EnsControlPlane {
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
      version: 1,
      network: "eip155:4663",
      updatedAt: now.toISOString(),
      expiresAt: "2026-07-26T12:00:00.000Z",
      paused,
      fleet: {
        scout: "scout.u-12345678.demo.eth",
        risk: "risk.u-12345678.demo.eth",
        trader: "trader.u-12345678.demo.eth",
        auditor: "auditor.u-12345678.demo.eth",
      },
      policy: {
        allowedTickers: ["NVDA", "AMZN"],
        maxAmountPerTrade: "1000000",
        maxDeviationBps: 300,
        minLiquidityUsd: 50_000,
        maxOracleAgeSeconds: 300,
      },
    },
  };
}

function asset(): StockCatalogAsset {
  return {
    ticker: "NVDA",
    name: "NVIDIA",
    tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    multiplier: "1",
    robinhoodStatus: "ACTIVE",
    tradability: "TRADABLE",
    priceSource: "robinhood-price-api",
    referencePrice: 100,
    referenceUpdatedAt: "2026-07-25T11:59:30.000Z",
    uniswapRoutable: true,
    uniswapRouting: "V4",
    uniswapRequestId: "quote-NVDA",
    quotedAmountIn: "1000000",
    quotedAmountOut: "10000000000000000",
    uniswapImpliedPrice: 100.2,
    deviationBps: 20,
    graphEvidence: {
      source: "the-graph-substreams",
      healthy: true,
      protocol: "v4",
      blockNumber: "1000",
      liquidityUsd: 250_000,
      lastSwapPrice: 100.1,
      transactionHash: `0x${"33".repeat(32)}`,
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
