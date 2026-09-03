import { describe, expect, it } from "vitest";
import {
  gasTopUpAmount,
  onchainStrategyId,
} from "./eqlty-vault-executor.js";
import type { ExecutionStrategy } from "./execution-types.js";

describe("EQLTY vault strategy selection", () => {
  it("uses the strategy funded by the authenticated wallet", () => {
    expect(
      onchainStrategyId({
        onchain: {
          chainId: 4663,
          strategyId: "42",
        },
      } as ExecutionStrategy),
    ).toBe(42n);
  });

  it("rejects strategies that have not been funded on Robinhood Chain", () => {
    expect(() =>
      onchainStrategyId({} as ExecutionStrategy),
    ).toThrow("not funded");
  });
});

describe("EQLTY server wallet gas", () => {
  it("tops a low balance up to the target", () => {
    expect(gasTopUpAmount(100n, 500n, 1_000n)).toBe(900n);
  });

  it("reuses a balance that covers the minimum", () => {
    expect(gasTopUpAmount(500n, 500n, 1_000n)).toBe(0n);
  });

  it("rejects an invalid sponsorship range", () => {
    expect(() => gasTopUpAmount(0n, 1_000n, 500n)).toThrow(
      "target",
    );
  });
});
