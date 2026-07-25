import { describe, expect, it } from "vitest";
import { onchainStrategyId } from "./eqlty-vault-executor.js";
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
