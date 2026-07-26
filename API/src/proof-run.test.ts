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
      poolAddress:
        "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      transactionHash: `0x${"33".repeat(32)}`,
      eventTopic: `0x${"44".repeat(32)}`,
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

  it("executes a wallet-authorized purchase below the 1Claw lock", async () => {
    const prepare = vi.fn().mockResolvedValue(preparedSwap());
    const execute = vi.fn();
    execute.mockResolvedValue({
      transactionHash: `0x${"55".repeat(32)}`,
      requestId: "execution-quote",
      routing: "CLASSIC",
      quotedAmountOut: "9900000000000000",
    });
    const { service, strategyId } = setup({
      executor: {
        ready: () => true,
        prepare,
        execute,
      },
    });

    const run = await service.run({
      ...runInput(strategyId),
      execute: true,
    });

    expect(run.status).toBe("executed");
    expect(prepare).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(run.quote?.requestId).toBe("execution-quote");
    expect(run.transactionHash).toBe(`0x${"55".repeat(32)}`);
  });

  it("keeps x401 and x402 required for a protected purchase", async () => {
    const prepare = vi.fn();
    const execute = vi.fn();
    const { service, strategyId } = setup(
      {
        controlPlane: {
          resolve: async () => controlPlane(false, "3000000"),
        },
        executor: {
          ready: () => true,
          prepare,
          execute,
        },
      },
      "3000000",
    );

    const run = await service.run({
      ...runInput(strategyId),
      amountIn: "3000000",
      execute: true,
      oneclaw: {
        required: true,
        linked: true,
        minimumAmount: "3000000",
        executionAuthorized: true,
      },
    });

    expect(run.status).toBe("rejected");
    expect(run.rejectionReason).toContain("x401 and x402");
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a 3 USDG purchase without the trader rail", async () => {
    const execute = vi.fn();
    const { service, strategyId } = setup(
      {
        controlPlane: {
          resolve: async () => controlPlane(false, "3000000"),
        },
        executor: {
          ready: () => true,
          prepare: vi.fn(),
          execute,
        },
      },
      "3000000",
    );

    const run = await service.run({
      ...runInput(strategyId),
      amountIn: "3000000",
      execute: true,
      oneclaw: {
        required: true,
        linked: false,
        minimumAmount: "3000000",
        executionAuthorized: false,
      },
    });

    expect(run.status).toBe("rejected");
    expect(run.rejectionReason).toContain("3 USDG");
    expect(execute).not.toHaveBeenCalled();
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
  maxAmount = "1000000",
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
    maxAmountPerTrade: maxAmount,
    maxTotalSpend: maxAmount,
    maxSlippageBps: 100,
    expiresAt: "2026-07-26T12:00:00.000Z",
    executionMode: "full",
  });
  const service = new ProofRunService(loadConfig({}), store, {
    catalog: { assessTicker: async () => asset() },
    controlPlane: { resolve: async () => controlPlane(false, maxAmount) },
    now: () => now,
    id: () => "run-1",
    ...dependencies,
  });
  return { service, strategyId: strategy.id };
}

function preparedSwap() {
  return {
    amountOut: "9900000000000000",
    requestId: "execution-quote",
    routing: "CLASSIC",
    rawQuote: {
      input: {
        token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        amount: "1000000",
      },
    },
    transaction: {
      to: "0x8876789976decbfcbbbe364623c63652db8c0904" as const,
      from: "0x9999999999999999999999999999999999999999" as const,
      data: "0x1234" as const,
      value: "0",
      chainId: 4663,
    },
  };
}

function runInput(strategyId: string) {
  return {
    strategyId,
    amountIn: "1000000",
    execute: false,
    userId: "u-12345678",
    owner,
    oneclaw: {
      required: false,
      linked: false,
      minimumAmount: "3000000",
      executionAuthorized: true,
    },
  };
}

function controlPlane(
  paused = false,
  maxAmountPerTrade = "1000000",
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
        maxAmountPerTrade,
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
