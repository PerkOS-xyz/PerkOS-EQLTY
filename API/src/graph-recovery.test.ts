import { describe, expect, it } from "vitest";
import {
  graphAdapterErrorCode,
  graphRecoveryPlan,
  graphRetryDelayMs,
  graphSyncPercent,
} from "./graph-recovery.js";

describe("The Graph recovery", () => {
  it("classifies quota failures without exposing the raw provider message", () => {
    expect(
      graphAdapterErrorCode("billable processed blocks quota exceeded"),
    ).toBe("quota-exhausted");
    expect(graphAdapterErrorCode("connection reset by peer")).toBe(
      "provider-error",
    );
  });

  it("backs off quota retries more slowly than transient failures", () => {
    expect(graphRetryDelayMs("provider-error", 0)).toBe(2_000);
    expect(graphRetryDelayMs("provider-error", 10)).toBe(60_000);
    expect(graphRetryDelayMs("quota-exhausted", 0)).toBe(60_000);
    expect(graphRetryDelayMs("quota-exhausted", 10)).toBe(900_000);
  });

  it("reports deterministic sync progress", () => {
    expect(graphSyncPercent("1500", "2000")).toBe(75);
    expect(graphSyncPercent("2001", "2000")).toBe(100);
    expect(graphSyncPercent("0", "0")).toBeUndefined();
  });

  it("keeps lagging evidence closed while the adapter catches up", () => {
    expect(
      graphRecoveryPlan({
        reason: "lagging",
        processedBlock: "1500",
        providerHeadBlock: "2000",
        lagBlocks: 500,
      }),
    ).toMatchObject({
      state: "recovering",
      action: "wait-for-sync",
      automatic: true,
      blocksRemaining: 500,
      syncPercent: 75,
    });
  });
});
