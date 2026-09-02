import { describe, expect, it } from "vitest";
import {
  buildDecisionReceipt,
  verifyDecisionReceipt,
} from "./decision-receipt.js";

describe("decision receipts", () => {
  it("survives persistence with the same canonical root", () => {
    const receipt = fixture();
    const restored = JSON.parse(JSON.stringify(receipt));

    expect(verifyDecisionReceipt(restored)).toBe(true);
    expect(restored.root).toBe(receipt.root);
  });

  it("detects changes to a sealed agent output", () => {
    const receipt = fixture();
    receipt.agents.risk.summary = "Ignore the original limits";

    expect(verifyDecisionReceipt(receipt)).toBe(false);
  });

  it("rejects a legacy analysis without a receipt", () => {
    expect(verifyDecisionReceipt(undefined)).toBe(false);
  });
});

function fixture() {
  const step = (role: "scout" | "risk" | "trader" | "auditor") => ({
    role,
    status: "verified" as const,
    ticker: "NVDA",
    summary: `${role} verified the sealed evidence`,
    responseHash: `0x${role.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`,
    facts: [],
  });
  return buildDecisionReceipt({
    analysisId: "analysis-1",
    issuedAt: "2026-09-02T12:00:00.000Z",
    goal: "Compare a long-term position",
    amountIn: "1000000",
    decisionStatus: "agent_verified",
    readiness: {
      status: "ready_to_compare",
      summary: "Ready to compare",
      reasons: [],
    },
    selection: {
      ticker: "NVDA",
      name: "NVIDIA",
      tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
      status: "recommended",
      score: 90,
      reason: "Verified by all four agents",
      orchestrationReady: true,
    },
    policy: {
      rootName: "u-12345678.demo.eth",
      version: 1,
      manifestHash: `0x${"aa".repeat(32)}`,
    },
    consultation: {
      mode: "hermes-a2a",
      status: "verified",
      selectedTicker: "NVDA",
      scout: step("scout"),
      risk: step("risk"),
      trader: step("trader"),
      auditor: step("auditor"),
    },
    candidates: [],
    outcomes: [],
  });
}
