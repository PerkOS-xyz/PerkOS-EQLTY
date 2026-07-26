import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import { EnsControlPlaneService as ControlPlane } from "./ens-control-plane.js";
import type {
  OpportunityAnalysis,
  OpportunityCandidate,
} from "./goal-types.js";
import type {
  EvmAddress,
  StockCatalogAsset,
} from "./market-types.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { StockCatalogService as Catalog } from "./stock-catalog.js";
import type { ApiConfig } from "./config.js";

type Dependencies = {
  catalog?: Pick<StockCatalogService, "assessTicker">;
  controlPlane?: Pick<EnsControlPlaneService, "resolve">;
  now?: () => Date;
  id?: () => string;
};

export class OpportunityAnalysisService {
  private readonly catalog: Pick<StockCatalogService, "assessTicker">;
  private readonly controlPlane: Pick<EnsControlPlaneService, "resolve">;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog ?? new Catalog(config);
    this.controlPlane =
      dependencies.controlPlane ?? new ControlPlane(config);
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
  }

  async analyze(input: {
    goal: string;
    amountIn: string;
    maxCandidates: number;
    candidateTickers?: string[];
    userId: string;
    owner: EvmAddress;
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
            tickers.map((ticker) => this.catalog.assessTicker(ticker)),
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
              : "Robinhood, Uniswap or The Graph evidence is unavailable",
          );
        }
        if (!result.value) {
          return rejected(
            ticker,
            "Robinhood, Uniswap or The Graph evidence is unavailable",
          );
        }
        return score(result.value, manifest.policy, this.now());
      })
      .sort(compareCandidates);

    const winner = candidates.find(
      (candidate) => candidate.status === "eligible",
    );
    if (winner) {
      winner.status = "recommended";
      winner.reason =
        "Best policy-compatible route with fresh Uniswap and Substreams evidence.";
    }
    for (const candidate of candidates) {
      if (candidate.status === "eligible") {
        candidate.reason =
          "Policy-compatible route ranked below the selected candidate.";
      }
    }

    const evaluatedAt = this.now().toISOString();
    const proofInput = {
      goal: input.goal,
      amountIn: input.amountIn,
      policyManifestHash: controlPlane.manifestHash,
      evaluatedAt,
      candidates: candidates.map((candidate) => ({
        ticker: candidate.ticker,
        status: candidate.status,
        score: candidate.score,
        deviationBps: candidate.deviationBps,
        uniswapRequestId: candidate.uniswapRequestId,
      })),
    };

    return {
      id: this.id(),
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
      recommendedTicker: winner?.ticker,
      candidates,
      proofRoot: keccak256(stringToHex(JSON.stringify(proofInput))),
    };
  }
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
            ? "The Graph evidence is not healthy"
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
