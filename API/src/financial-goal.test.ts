import { describe, expect, it } from "vitest";
import { evaluateGoalReadiness } from "./financial-goal.js";

describe("financial goal readiness", () => {
  it("keeps learning in exploration mode", () => {
    expect(
      evaluateGoalReadiness({
        purpose: "learn",
        horizonMonths: 36,
        liquidityNeed: "can-commit",
        riskComfort: "medium",
      }).status,
    ).toBe("explore_only");
  });

  it("returns no action for short funds that may be needed", () => {
    expect(
      evaluateGoalReadiness({
        purpose: "planned-purchase",
        horizonMonths: 6,
        liquidityNeed: "may-need",
        riskComfort: "low",
      }).status,
    ).toBe("no_action");
  });

  it("allows a bounded long-term comparison", () => {
    expect(
      evaluateGoalReadiness({
        purpose: "long-term-growth",
        horizonMonths: 60,
        liquidityNeed: "can-commit",
        riskComfort: "medium",
      }).status,
    ).toBe("ready_to_compare");
  });
});
