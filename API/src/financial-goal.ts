export type FinancialGoalProfile = {
  purpose: "learn" | "long-term-growth" | "planned-purchase";
  horizonMonths: number;
  liquidityNeed: "may-need" | "can-commit";
  riskComfort: "low" | "medium" | "high";
};

export type GoalReadiness = {
  status:
    | "explore_only"
    | "limited_position"
    | "ready_to_compare"
    | "no_action";
  summary: string;
  reasons: string[];
};

export function evaluateGoalReadiness(
  profile?: FinancialGoalProfile,
): GoalReadiness {
  if (!profile) {
    return {
      status: "ready_to_compare",
      summary: "The legacy objective can be compared under the active policy.",
      reasons: ["No structured goal profile was supplied."],
    };
  }
  if (profile.purpose === "learn") {
    return {
      status: "explore_only",
      summary: "Explore the evidence before preparing a purchase.",
      reasons: [
        "The selected goal is learning rather than committing capital.",
        "The fleet can compare candidates without preparing execution.",
      ],
    };
  }
  if (
    profile.horizonMonths < 12 &&
    profile.liquidityNeed === "may-need"
  ) {
    return {
      status: "no_action",
      summary: "A Stock Token purchase does not fit this short, liquid horizon.",
      reasons: [
        "The funds may be needed within the next twelve months.",
        "The user should keep the option to act later after updating the goal.",
      ],
    };
  }
  if (
    profile.riskComfort === "low" ||
    profile.horizonMonths < 24 ||
    profile.purpose === "planned-purchase"
  ) {
    return {
      status: "limited_position",
      summary: "Compare a limited position and keep execution optional.",
      reasons: [
        "The goal benefits from a smaller exposure limit.",
        "Risk and liquidity trade-offs must be visible before approval.",
      ],
    };
  }
  return {
    status: "ready_to_compare",
    summary: "The profile is ready for a policy-bounded comparison.",
    reasons: [
      "The selected horizon supports a longer-term comparison.",
      "Execution remains optional and subject to the active ENS policy.",
    ],
  };
}
