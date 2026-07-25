import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { StockCatalogAsset } from "./market-types.js";
import { StrategyService } from "./strategy-service.js";
import { StrategyStore } from "./strategy-store.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;
const now = Date.parse("2026-07-25T12:00:00.000Z");

describe("strategy service", () => {
  it("creates a full strategy only for a verified route", async () => {
    const service = createService(asset(true));

    const strategy = await service.create(input());

    expect(strategy).toMatchObject({
      ticker: "NVDA",
      owner,
      executionMode: "full",
      status: "active",
    });
  });

  it("keeps incomplete market coverage analysis-only", async () => {
    const service = createService(asset(false));

    const strategy = await service.create(input());

    expect(strategy.executionMode).toBe("analysis");
  });

  it("rejects mismatched tokens, routers and unsafe expiry", async () => {
    const service = createService(asset(true));

    await expect(
      service.create({
        ...input(),
        agent: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow("authorized trader");
    await expect(
      service.create({
        ...input(),
        outputToken: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow("ticker and output token");
    await expect(
      service.create({
        ...input(),
        router: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow("authorized Uniswap router");
    await expect(
      service.create({
        ...input(),
        expiresAt: "2026-08-10T12:00:00.000Z",
      }),
    ).rejects.toThrow("next seven days");
  });
});

function createService(entry: StockCatalogAsset) {
  return new StrategyService(
    loadConfig({}),
    new StrategyStore({
      id: () => "strategy-1",
      now: () => now,
    }),
    {
      catalog: { assessTicker: async () => entry },
      now: () => now,
    },
  );
}

function input() {
  return {
    owner,
    agent: owner,
    ticker: "nvda",
    inputToken:
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
    outputToken:
      "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as const,
    router: "0x8876789976decbfcbbbe364623c63652db8c0904" as const,
    maxAmountPerTrade: "1000000",
    maxTotalSpend: "1000000",
    maxSlippageBps: 100,
    expiresAt: "2026-07-26T12:00:00.000Z",
  };
}

function asset(ready: boolean): StockCatalogAsset {
  return {
    ticker: "NVDA",
    name: "NVIDIA",
    tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    multiplier: "1",
    robinhoodStatus: "ACTIVE",
    tradability: "TRADABLE",
    priceSource: "robinhood-price-api",
    uniswapRoutable: true,
    quotedAmountIn: "1000000",
    status: ready ? "available" : "blocked",
    reasons: ready ? [] : ["Graph evidence is unavailable"],
    orchestrationReady: ready,
  };
}
