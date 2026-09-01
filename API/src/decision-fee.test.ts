import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { DecisionFeeService } from "./decision-fee.js";
import type {
  DecisionFee,
  DecisionFeePaymentPayload,
} from "./decision-fee-types.js";
import type { OpportunityAnalysis } from "./goal-types.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;
const recipient =
  "0x2222222222222222222222222222222222222222" as const;
const usdG =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;

describe("decision fees", () => {
  it("prices a verified recommendation and does not charge in preview", () => {
    const service = new DecisionFeeService(loadConfig({}));

    expect(service.quote(analysis(true))).toMatchObject({
      mode: "preview",
      status: "preview",
      scheme: "exact",
      amount: "200000",
      maximumAmount: "250000",
      symbol: "USDG",
    });
  });

  it("waives the fee when any agent proof is unavailable", () => {
    const service = new DecisionFeeService(loadConfig({}));
    const value = analysis(true);
    value.consultation.auditor.status = "unavailable";

    expect(service.quote(value)).toMatchObject({
      status: "waived",
      amount: "0",
    });
  });

  it("prices a verified no-candidate result at the lower exact fee", () => {
    const service = new DecisionFeeService(liveConfig());

    expect(service.quote(analysis(false))).toMatchObject({
      status: "payment-required",
      amount: "50000",
      requirements: {
        scheme: "exact",
        network: "eip155:4663",
        amount: "50000",
        asset: usdG,
        payTo: recipient,
      },
    });
  });

  it("settles through Stack and preserves a verifiable receipt", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, _init) =>
      new Response(
        JSON.stringify({
          success: true,
          payer: owner,
          transaction: `0x${"ab".repeat(32)}`,
          network: "eip155:4663",
          receipt: {
            requestId: "x402-request-1",
            timestamp: "2026-07-30T14:00:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const service = new DecisionFeeService(
      liveConfig(),
      fetcher,
    );
    const fee = service.quote(analysis(true));
    const settled = await service.settle({
      fee,
      goalId: "goal-1",
      owner,
      payment: payment(fee),
    });

    expect(settled).toMatchObject({
      status: "settled",
      receipt: {
        payer: owner,
        amount: "200000",
        requestId: "x402-request-1",
        transaction: `0x${"ab".repeat(32)}`,
      },
    });
    const request = fetcher.mock.calls[0];
    expect(String(request?.[0])).toBe(
      "https://stack.perkos.xyz/api/v2/x402/settle",
    );
    const body = JSON.parse(
      String((request?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      x402Version: 2,
      paymentRequirements: {
        scheme: "exact",
        amount: "200000",
      },
    });
  });

  it("rejects an authorization for a different payer or amount", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new DecisionFeeService(
      liveConfig(),
      fetcher,
    );
    const fee = service.quote(analysis(true));
    const invalid = payment(fee);
    invalid.payload.authorization.value = "1";

    await expect(
      service.settle({
        fee,
        goalId: "goal-1",
        owner,
        payment: invalid,
      }),
    ).rejects.toThrow("does not match the exact fee");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function liveConfig() {
  return loadConfig({
    EQLTY_DECISION_FEE_MODE: "live",
    EQLTY_DECISION_FEE_RECIPIENT: recipient,
  });
}

function payment(fee: DecisionFee): DecisionFeePaymentPayload {
  if (!fee.requirements) {
    throw new Error("Payment requirements are missing");
  }
  return {
    x402Version: 2,
    resource: {
      url: "https://eqlty-api.perkos.xyz/api/goals/goal-1/decision-fee",
      description: "EQLTY verified agent decision",
      mimeType: "application/json",
    },
    accepted: fee.requirements,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: owner,
        to: fee.requirements.payTo,
        value: fee.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1_000) + 600),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
    extensions: {},
  };
}

function analysis(recommended: boolean): OpportunityAnalysis {
  const step = (role: "scout" | "risk" | "trader" | "auditor") => ({
    role,
    status: "verified" as const,
    facts: [],
  });
  return {
    id: "analysis-1",
    goal: "Find a policy-compatible stock-token opportunity",
    amountIn: "1000000",
    mode: "analysis",
    policy: {
      source: "durin",
      rootName: "u-123.demo.eth",
      version: 1,
      manifestHash: `0x${"aa".repeat(32)}`,
      allowedTickers: ["AMZN"],
      paused: false,
    },
    evaluatedAt: "2026-07-30T14:00:00.000Z",
    decisionStatus: recommended
      ? "agent_verified"
      : "insufficient_evidence",
    readiness: {
      status: "ready_to_compare",
      summary: "Ready to compare",
      reasons: [],
    },
    recommendedTicker: recommended ? "AMZN" : undefined,
    candidates: [],
    outcomes: [],
    consultation: {
      mode: "hermes-a2a",
      status: "verified",
      selectedTicker: recommended ? "AMZN" : undefined,
      scout: step("scout"),
      risk: step("risk"),
      trader: step("trader"),
      auditor: step("auditor"),
    },
    proofRoot: `0x${"bb".repeat(32)}`,
  };
}
