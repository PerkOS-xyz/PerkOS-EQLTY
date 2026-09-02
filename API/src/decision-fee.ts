import { getAddress } from "viem";
import { z } from "zod";
import type { ApiConfig } from "./config.js";
import type {
  DecisionFee,
  DecisionFeePaymentPayload,
  DecisionFeeReceipt,
  DecisionFeeRequirements,
} from "./decision-fee-types.js";
import type { OpportunityAnalysis } from "./goal-types.js";
import { verifyDecisionReceipt } from "./decision-receipt.js";
import type { EvmAddress } from "./market-types.js";

const usdG =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const transactionHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const settlementResponse = z
  .object({
    success: z.literal(true),
    payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    transaction: transactionHash.nullable(),
    network: z.literal("eip155:4663"),
    receipt: z
      .object({
        requestId: z.string().min(1).max(256).optional(),
        timestamp: z.string().datetime().optional(),
      })
      .passthrough(),
  })
  .passthrough();

type Fetch = typeof fetch;

export class DecisionFeeService {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetcher: Fetch = fetch,
  ) {}

  quote(analysis: OpportunityAnalysis): DecisionFee {
    const verified = [
      analysis.consultation.scout,
      analysis.consultation.risk,
      analysis.consultation.trader,
      analysis.consultation.auditor,
    ].every((step) => step.status === "verified") &&
      verifyDecisionReceipt(analysis.receipt) &&
      analysis.proofRoot === analysis.receipt.root;

    if (!verified || analysis.consultation.status !== "verified") {
      return this.base({
        amount: "0",
        status: "waived",
        decisionReceiptRoot: analysis.receipt?.root,
        reason:
          "No fee: the four-agent consultation did not produce a fully verified proof.",
      });
    }

    const hasCandidate = Boolean(analysis.recommendedTicker);
    const amount = hasCandidate
      ? this.config.EQLTY_DECISION_FEE_COMPLETE_AMOUNT
      : this.config.EQLTY_DECISION_FEE_NO_CANDIDATE_AMOUNT;
    const reason = hasCandidate
      ? "Verified four-agent recommendation with ENS, Uniswap and The Graph evidence."
      : "Verified four-agent consultation with no candidate advancing.";

    if (this.config.EQLTY_DECISION_FEE_MODE === "preview") {
      return this.base({
        amount,
        status: "preview",
        reason,
        decisionReceiptRoot: analysis.receipt.root,
      });
    }

    return this.base({
      amount,
      status: "payment-required",
      reason,
      decisionReceiptRoot: analysis.receipt.root,
      requirements: this.requirements(amount),
    });
  }

  async settle(input: {
    fee: DecisionFee;
    goalId: string;
    owner: EvmAddress;
    payment: DecisionFeePaymentPayload;
  }): Promise<DecisionFee> {
    if (
      input.fee.status !== "payment-required" ||
      !input.fee.requirements
    ) {
      throw new Error("This decision does not require payment");
    }
    const requirements = input.fee.requirements;
    const decisionReceiptRoot = input.fee.decisionReceiptRoot;
    if (!decisionReceiptRoot) {
      throw new Error("Start a new consultation to create a decision receipt");
    }
    this.validateAuthorization(input.owner, requirements, input.payment);
    const paymentPayload: DecisionFeePaymentPayload = {
      ...input.payment,
      accepted: requirements,
      resource: {
        url: new URL(
          `/api/goals/${encodeURIComponent(input.goalId)}/decision-fee`,
          this.config.EQLTY_PUBLIC_API_URL,
        ).toString(),
        description: `EQLTY decision ${decisionReceiptRoot}`,
        mimeType: "application/json",
      },
      extensions: {},
    };
    const response = await this.fetcher(
      new URL("/api/v2/x402/settle", this.config.EQLTY_X402_FACILITATOR_URL),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements: requirements,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(stackError(body, response.status));
    }
    const parsed = settlementResponse.safeParse(body);
    if (!parsed.success) {
      throw new Error("Stack returned an invalid x402 settlement receipt");
    }
    if (
      getAddress(parsed.data.payer) !== getAddress(input.owner)
    ) {
      throw new Error("Stack receipt payer does not match the goal owner");
    }

    const receipt: DecisionFeeReceipt = {
      payer: getAddress(parsed.data.payer),
      amount: requirements.amount,
      asset: requirements.asset,
      network: requirements.network,
      decisionReceiptRoot,
      authorizationNonce:
        input.payment.payload.authorization.nonce,
      transaction:
        (parsed.data.transaction as `0x${string}` | null) ?? undefined,
      explorerUrl: parsed.data.transaction
        ? `https://robinhoodchain.blockscout.com/tx/${parsed.data.transaction}`
        : undefined,
      requestId:
        parsed.data.receipt.requestId ??
        response.headers.get("x-x402-request-id") ??
        undefined,
      settledAt:
        parsed.data.receipt.timestamp ?? new Date().toISOString(),
    };
    return {
      ...input.fee,
      status: "settled",
      receipt,
      error: undefined,
    };
  }

  failed(fee: DecisionFee, error: unknown): DecisionFee {
    return {
      ...fee,
      status: "payment-required",
      error:
        error instanceof Error
          ? error.message
          : "Decision fee settlement failed",
    };
  }

  private base(input: {
    amount: string;
    status: DecisionFee["status"];
    reason: string;
    decisionReceiptRoot?: `0x${string}`;
    requirements?: DecisionFeeRequirements;
  }): DecisionFee {
    return {
      mode: this.config.EQLTY_DECISION_FEE_MODE,
      scheme: "exact",
      maximumAmount: this.config.EQLTY_DECISION_FEE_MAX_AMOUNT,
      decimals: 6,
      symbol: "USDG",
      ...input,
    };
  }

  private requirements(amount: string): DecisionFeeRequirements {
    const recipient = this.config.EQLTY_DECISION_FEE_RECIPIENT;
    if (!recipient) {
      throw new Error("The EQLTY decision-fee recipient is not configured");
    }
    return {
      scheme: "exact",
      network: "eip155:4663",
      amount,
      asset: usdG,
      payTo: getAddress(recipient),
      maxTimeoutSeconds: 600,
      extra: {
        name: "Global Dollar",
        version: "1",
      },
    };
  }

  private validateAuthorization(
    owner: EvmAddress,
    requirements: DecisionFeeRequirements,
    payment: DecisionFeePaymentPayload,
  ): void {
    const authorization = payment.payload.authorization;
    if (payment.x402Version !== 2) {
      throw new Error("Only x402 v2 decision payments are supported");
    }
    if (getAddress(authorization.from) !== getAddress(owner)) {
      throw new Error("Payment signer does not match the goal owner");
    }
    if (
      getAddress(authorization.to) !== getAddress(requirements.payTo) ||
      authorization.value !== requirements.amount
    ) {
      throw new Error("Payment authorization does not match the exact fee");
    }
    if (
      payment.accepted.network !== requirements.network ||
      getAddress(payment.accepted.asset) !==
        getAddress(requirements.asset)
    ) {
      throw new Error("Payment authorization uses the wrong x402 rail");
    }
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const validAfter = BigInt(authorization.validAfter);
    const validBefore = BigInt(authorization.validBefore);
    if (
      validAfter > now ||
      validBefore <= now ||
      validBefore >
        now + BigInt(requirements.maxTimeoutSeconds)
    ) {
      throw new Error("Payment authorization is outside the allowed time window");
    }
  }
}

function stackError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
  }
  return `Stack x402 settlement failed with status ${status}`;
}
