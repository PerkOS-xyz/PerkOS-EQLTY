import { randomUUID } from "node:crypto";
import { buildDecisionReceipt } from "./decision-receipt.js";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import { EnsControlPlaneService as ControlPlane } from "./ens-control-plane.js";
import type {
  AgentConsultation,
  ConsultationStep,
} from "./consultation-types.js";
import type { FleetAgent, FleetRole } from "./fleet-types.js";
import type {
  OpportunityAnalysis,
  OpportunityCandidate,
} from "./goal-types.js";
import type { HermesConsultationService } from "./hermes-consultation.js";
import { HermesConsultationService as Consultation } from "./hermes-consultation.js";
import type {
  EvmAddress,
  StockCatalogAsset,
} from "./market-types.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { StockCatalogService as Catalog } from "./stock-catalog.js";
import type { ApiConfig } from "./config.js";
import {
  evaluateGoalReadiness,
  type FinancialGoalProfile,
} from "./financial-goal.js";
import type { DecisionOutcome } from "./goal-types.js";

type Dependencies = {
  catalog?: Pick<StockCatalogService, "assessTicker">;
  controlPlane?: Pick<EnsControlPlaneService, "resolve">;
  consultation?: Pick<HermesConsultationService, "consult">;
  now?: () => Date;
  id?: () => string;
};

export class OpportunityAnalysisService {
  private readonly catalog: Pick<StockCatalogService, "assessTicker">;
  private readonly controlPlane: Pick<EnsControlPlaneService, "resolve">;
  private readonly consultation: Pick<HermesConsultationService, "consult">;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog ?? new Catalog(config);
    this.controlPlane =
      dependencies.controlPlane ?? new ControlPlane(config);
    this.consultation =
      dependencies.consultation ?? new Consultation(config);
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
  }

  async analyze(input: {
    goal: string;
    profile?: FinancialGoalProfile;
    amountIn: string;
    maxCandidates: number;
    candidateTickers?: string[];
    userId: string;
    owner: EvmAddress;
    fleetAgents?: FleetAgent[];
    perkosIdToken?: string;
  }): Promise<OpportunityAnalysis> {
    const controlPlane = await this.controlPlane.resolve({
      userId: input.userId,
      owner: input.owner,
    });
    if (
      controlPlane.status !== "active" ||
      !controlPlane.rootName ||
      !controlPlane.manifest ||
      !controlPlane.manifestHash
    ) {
      throw new Error(
        controlPlane.error ?? "ENS fleet policy is not active",
      );
    }
    const manifest = controlPlane.manifest;
    const allowedTickers = manifest.policy.allowedTickers;
    const requested = new Set(
      input.candidateTickers?.map((ticker) =>
        ticker.trim().toUpperCase(),
      ),
    );
    const tickers = allowedTickers
      .filter((ticker) => requested.size === 0 || requested.has(ticker))
      .slice(0, input.maxCandidates);
    if (tickers.length === 0) {
      throw new Error("No requested ticker is allowed by the ENS policy");
    }

    const budgetExceeded =
      BigInt(input.amountIn) >
      BigInt(manifest.policy.maxAmountPerTrade);
    const assessments =
      manifest.paused || budgetExceeded
        ? []
        : await Promise.allSettled(
            tickers.map((ticker) =>
              this.catalog.assessTicker(ticker, undefined, input.amountIn),
            ),
          );
    const candidates = tickers
      .map((ticker, index) => {
        if (manifest.paused) {
          return rejected(
            ticker,
            `ENS policy v${manifest.version} paused all fleet activity`,
          );
        }
        if (budgetExceeded) {
          return rejected(
            ticker,
            "Goal budget exceeds the ENS maximum amount per trade",
          );
        }
        const result = assessments[index];
        if (!result || result.status === "rejected") {
          return rejected(
            ticker,
            result?.status === "rejected"
              ? `Market assessment failed: ${message(result.reason)}`
              : "Robinhood, Uniswap or onchain evidence is unavailable",
          );
        }
        if (!result.value) {
          return rejected(
            ticker,
            "Robinhood, Uniswap or onchain evidence is unavailable",
          );
        }
        return score(result.value, manifest.policy, this.now());
      })
      .sort(compareCandidates);

    // The agents can only choose among eligible candidates, so asking them
    // when none passed the rules spends model time for a certain refusal.
    const consultation = candidates.some(
      (candidate) => candidate.status === "eligible",
    )
      ? await this.consultation.consult({
          goal: input.goal,
          candidates,
          manifest,
          manifestHash: controlPlane.manifestHash,
          agents: input.fleetAgents,
          idToken: input.perkosIdToken,
        })
      : skippedConsultation(input.fleetAgents);
    const readiness = evaluateGoalReadiness(input.profile);
    const selected =
      consultation.status === "verified"
        ? candidates.find(
            (candidate) =>
              candidate.ticker === consultation.selectedTicker &&
              candidate.status === "eligible",
          )
        : undefined;
    const winner = ["ready_to_compare", "limited_position"].includes(
      readiness.status,
    )
      ? selected
      : undefined;
    if (winner) {
      winner.status = "recommended";
      winner.reason = primaryReason(winner, candidates, {
        amountIn: input.amountIn,
        maxAmountPerTrade: manifest.policy.maxAmountPerTrade,
        allowedCompared: tickers.length === allowedTickers.length,
      });
    }
    for (const candidate of candidates) {
      if (candidate.status === "eligible") {
        candidate.reason = eligibleReason(
          candidate,
          input.amountIn,
          manifest.policy,
        );
      }
    }

    const analysisId = this.id();
    const evaluatedAt = this.now().toISOString();
    const decisionStatus = selected
      ? "agent_verified"
      : candidates.some((candidate) => candidate.status === "eligible")
        ? "rules_only"
        : "insufficient_evidence";
    const outcomes = decisionOutcomes(
      candidates,
      winner,
      readiness,
      winner ? consultation.scout.summary : undefined,
    );
    const receipt = buildDecisionReceipt({
      analysisId,
      issuedAt: evaluatedAt,
      goal: input.goal,
      profile: input.profile,
      amountIn: input.amountIn,
      decisionStatus,
      readiness,
      selection: winner,
      policy: {
        rootName: controlPlane.rootName,
        version: manifest.version,
        manifestHash: controlPlane.manifestHash,
      },
      consultation,
      candidates,
      outcomes,
    });

    return {
      id: analysisId,
      goal: input.goal,
      amountIn: input.amountIn,
      mode: "analysis",
      policy: {
        source: "durin",
        rootName: controlPlane.rootName,
        version: manifest.version,
        manifestHash: controlPlane.manifestHash,
        allowedTickers,
        paused: manifest.paused,
      },
      evaluatedAt,
      decisionStatus,
      readiness,
      recommendedTicker: winner?.ticker,
      candidates,
      outcomes,
      consultation,
      receipt,
      proofRoot: receipt.root,
    };
  }
}

function decisionOutcomes(
  candidates: OpportunityCandidate[],
  winner: OpportunityCandidate | undefined,
  readiness: ReturnType<typeof evaluateGoalReadiness>,
  agentNote?: string,
): DecisionOutcome[] {
  const eligible = candidates.filter(
    (candidate) => candidate.status !== "rejected",
  );
  const outcomes: DecisionOutcome[] = [];
  if (winner) {
    outcomes.push({
      kind: "primary",
      ticker: winner.ticker,
      title: `${winner.ticker} best fits the verified comparison`,
      summary: winner.reason,
      reasons: [
        ...(agentNote ? [`Agent note: ${agentNote}`] : []),
        `Readiness: ${readiness.status.replaceAll("_", " ")}`,
        "The four-agent consultation was verified against sealed evidence.",
      ],
    });
  }
  const alternative = eligible.find(
    (candidate) => candidate.ticker !== winner?.ticker,
  );
  if (alternative) {
    outcomes.push({
      kind: "alternative",
      ticker: alternative.ticker,
      title: `${alternative.ticker} is an evidence-backed alternative`,
      summary: alternative.reason,
      reasons: [
        "It passed deterministic ENS, Uniswap and onchain evidence gates.",
        winner
          ? "It was not selected by the verified consultation."
          : "Agent reasoning was unavailable, so this is not a recommendation.",
      ],
    });
  }
  outcomes.push({
    kind: "no_action",
    title: "Wait and keep the funds available",
    summary:
      readiness.status === "no_action"
        ? readiness.summary
        : "Execution is optional. Revisit the goal when evidence or circumstances change.",
    reasons: readiness.reasons,
  });
  return outcomes;
}

function score(
  asset: StockCatalogAsset,
  policy: {
    maxDeviationBps: number;
    minLiquidityUsd: number;
    maxOracleAgeSeconds: number;
  },
  now: Date,
): OpportunityCandidate {
  const base = {
    ticker: asset.ticker,
    name: asset.name,
    tokenAddress: asset.tokenAddress,
    referencePrice: numberString(asset.referencePrice),
    uniswapImpliedPrice: numberString(asset.uniswapImpliedPrice),
    deviationBps: asset.deviationBps,
    quotedAmountOut: asset.quotedAmountOut,
    uniswapRequestId: asset.uniswapRequestId,
    uniswapRouting: asset.uniswapRouting,
    graphEvidence: asset.graphEvidence
      ? {
          source: asset.graphEvidence.source,
          blockNumber: asset.graphEvidence.blockNumber,
          transactionHash: asset.graphEvidence.transactionHash,
          poolIdentifier: asset.graphEvidence.poolIdentifier,
          poolAddress: asset.graphEvidence.poolAddress,
          capturedAt: asset.graphEvidence.capturedAt,
          liquidityUsd: asset.graphEvidence.liquidityUsd,
        }
      : undefined,
  };
  const evidenceAge = asset.referenceUpdatedAt
    ? Math.max(
        0,
        (now.getTime() - Date.parse(asset.referenceUpdatedAt)) / 1_000,
      )
    : Number.POSITIVE_INFINITY;
  const rejection =
    !asset.orchestrationReady
      ? asset.reasons[0] ?? "Complete market evidence is unavailable"
      : asset.deviationBps === undefined
        ? "Uniswap price deviation is unavailable"
        : asset.deviationBps > policy.maxDeviationBps
          ? `Price deviation exceeds ${policy.maxDeviationBps} bps`
          : !asset.graphEvidence?.healthy
            ? "Onchain evidence is not healthy"
            : asset.graphEvidence.liquidityUsd < policy.minLiquidityUsd
              ? `Indexed liquidity is below $${policy.minLiquidityUsd}`
              : evidenceAge > policy.maxOracleAgeSeconds
                ? `Robinhood reference price is ${Math.round(evidenceAge)}s old`
                : undefined;
  if (rejection) {
    return {
      ...base,
      status: "rejected",
      score: 0,
      reason: rejection,
      orchestrationReady: false,
    };
  }

  const deviationPenalty = Math.min(50, asset.deviationBps! / 10);
  const liquidityBonus = Math.min(
    15,
    Math.log10(Math.max(1, asset.graphEvidence!.liquidityUsd)) * 2,
  );
  return {
    ...base,
    status: "eligible",
    score: Math.round(Math.max(0, 90 + liquidityBonus - deviationPenalty)),
    reason: "Policy-compatible route.",
    orchestrationReady: true,
  };
}

function skippedConsultation(
  agents: FleetAgent[] | undefined,
): AgentConsultation {
  const step = (role: FleetRole): ConsultationStep => {
    const agent = agents?.find((candidate) => candidate.role === role);
    return {
      role,
      agentId: agent?.agentId,
      agentName: agent?.name,
      status: "skipped",
      facts: [],
      detail:
        "No candidate passed the policy and market checks, so the agents were not asked.",
    };
  };
  return {
    mode: "deterministic-fallback",
    status: "unavailable",
    scout: step("scout"),
    risk: step("risk"),
    trader: step("trader"),
    auditor: step("auditor"),
  };
}

function rejected(
  ticker: string,
  reason: string,
): OpportunityCandidate {
  return {
    ticker,
    name: ticker,
    status: "rejected",
    score: 0,
    reason,
    orchestrationReady: false,
  };
}

/** Why the selected stock fits, built only from sealed numbers. */
function primaryReason(
  winner: OpportunityCandidate,
  candidates: OpportunityCandidate[],
  context: {
    amountIn: string;
    maxAmountPerTrade: string;
    allowedCompared: boolean;
  },
): string {
  const pools = candidates.filter((candidate) => candidate.graphEvidence);
  const liquidity = winner.graphEvidence?.liquidityUsd;
  const deepest =
    liquidity !== undefined &&
    pools.length > 1 &&
    pools.every(
      (candidate) => candidate.graphEvidence!.liquidityUsd <= liquidity,
    );
  return [
    quoteSentence(winner, context.amountIn) ??
      `${usdG(context.amountIn)} USDG passes every rule for ${winner.ticker}.`,
    deepest
      ? context.allowedCompared
        ? "Deepest pool among your allowed stocks."
        : `Deepest pool among the ${pools.length} stocks compared.`
      : liquidity !== undefined
        ? `Pool liquidity about ${compactMoney(liquidity)}.`
        : undefined,
    `Within your ${usdG(context.maxAmountPerTrade)} USDG limit.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function eligibleReason(
  candidate: OpportunityCandidate,
  amountIn: string,
  policy: {
    maxDeviationBps: number;
    minLiquidityUsd: number;
  },
): string {
  return [
    quoteSentence(candidate, amountIn) ?? "Passes every rule.",
    candidate.graphEvidence
      ? `Pool liquidity about ${compactMoney(
          candidate.graphEvidence.liquidityUsd,
        )}, above your ${numberMoney(policy.minLiquidityUsd)} minimum.`
      : undefined,
    `Price gap within your ${policy.maxDeviationBps / 100}% limit.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function quoteSentence(
  candidate: OpportunityCandidate,
  amountIn: string,
): string | undefined {
  const tokens = Number(candidate.quotedAmountOut) / 1e18;
  const price = Number(candidate.uniswapImpliedPrice);
  if (!(tokens > 0) || !Number.isFinite(tokens) || !(price > 0)) {
    return undefined;
  }
  const gap =
    candidate.deviationBps === undefined
      ? ""
      : ` (${
          candidate.deviationBps < 0.5
            ? "less than 0.01%"
            : `${(candidate.deviationBps / 100).toFixed(2)}%`
        } from the Robinhood price)`;
  return `${usdG(amountIn)} USDG buys about ${tokens.toLocaleString("en-US", {
    maximumSignificantDigits: 3,
  })} ${candidate.ticker} at about $${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${gap}.`;
}

function usdG(atomic: string): string {
  const amount = BigInt(atomic);
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${amount / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function numberMoney(value?: number): string {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return "value unavailable";
  }

  return `$${value!.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function compareCandidates(
  left: OpportunityCandidate,
  right: OpportunityCandidate,
): number {
  return Number(left.status === "rejected") -
      Number(right.status === "rejected") ||
    right.score - left.score ||
    left.ticker.localeCompare(right.ticker);
}

function numberString(value?: number): string | undefined {
  return value === undefined ? undefined : String(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
