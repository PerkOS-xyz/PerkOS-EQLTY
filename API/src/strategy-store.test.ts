import { describe, expect, it } from "vitest";
import { StrategyStore } from "./strategy-store.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;

describe("strategy store", () => {
  it("binds strategies and runs to the authenticated owner", () => {
    const store = new StrategyStore({
      id: () => "strategy-1",
      now: () => Date.parse("2026-07-25T12:00:00.000Z"),
    });
    const strategy = store.create(strategyInput());
    store.saveRun({
      id: "run-1",
      strategyId: strategy.id,
      ticker: "NVDA",
      amountIn: "1000000",
      executeRequested: false,
      status: "approved",
      createdAt: "2026-07-25T12:00:00.000Z",
      steps: [],
      handoffs: [],
      oneclaw: {
        required: false,
        linked: false,
        minimumAmount: "3000000",
        executionAuthorized: true,
      },
    });

    expect(strategy).toMatchObject({
      id: "strategy-1",
      status: "active",
      spent: "0",
      humanProof: {
        provider: "owner-wallet-session",
        status: "verified",
      },
    });
    expect(store.strategy("strategy-1", owner)).toEqual(strategy);
    expect(
      store.strategy(
        "strategy-1",
        "0x2222222222222222222222222222222222222222",
      ),
    ).toBeUndefined();
    expect(store.run("run-1", owner)?.status).toBe("approved");
  });

  it("expires a strategy when it is read after its deadline", () => {
    let now = Date.parse("2026-07-25T12:00:00.000Z");
    const store = new StrategyStore({
      id: () => "strategy-1",
      now: () => now,
    });
    store.create(strategyInput());
    now += 86_400_001;

    expect(store.strategy("strategy-1", owner)?.status).toBe("expired");
  });

  it("binds one immutable onchain strategy to its owner", () => {
    const store = new StrategyStore({
      id: () => "strategy-1",
      now: () => Date.parse("2026-07-25T12:00:00.000Z"),
    });
    store.create(strategyInput());
    const onchain = {
      chainId: 4663 as const,
      strategyId: "7",
      creationTransactionHash: `0x${"11".repeat(32)}` as const,
      approvalTransactionHash: `0x${"22".repeat(32)}` as const,
      fundingTransactionHash: `0x${"33".repeat(32)}` as const,
    };

    expect(
      store.bindOnchain("strategy-1", owner, onchain)?.onchain,
    ).toEqual(onchain);
    expect(
      store.bindOnchain(
        "strategy-1",
        "0x2222222222222222222222222222222222222222",
        onchain,
      ),
    ).toBeUndefined();
    expect(
      store.bindOnchain("strategy-1", owner, {
        ...onchain,
        strategyId: "8",
      }),
    ).toBeUndefined();
  });
});

function strategyInput() {
  return {
    ticker: "NVDA",
    owner,
    agent: owner,
    inputToken:
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
    outputToken:
      "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as const,
    router: "0x8876789976decbfcbbbe364623c63652db8c0904" as const,
    maxAmountPerTrade: "1000000",
    maxTotalSpend: "1000000",
    maxSlippageBps: 100,
    expiresAt: "2026-07-26T12:00:00.000Z",
    executionMode: "full" as const,
  };
}
