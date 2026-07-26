import { randomUUID } from "node:crypto";
import type { ApiConfig } from "./config.js";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import { EnsControlPlaneService as ControlPlane } from "./ens-control-plane.js";
import type {
  ProofMode,
  RunStep,
  TradeRun,
} from "./execution-types.js";
import type { EvmAddress, StockCatalogAsset } from "./market-types.js";
import type { OneClawGate } from "./oneclaw-policy.js";
import { createHandoff, hashPayload } from "./proof-handoff.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { StockCatalogService as Catalog } from "./stock-catalog.js";
import type { StrategyStore } from "./strategy-store.js";
import {
  disabledTradeExecutor,
  type TradeExecutor,
} from "./trade-executor.js";

type Dependencies = {
  catalog?: Pick<StockCatalogService, "assessTicker">;
  controlPlane?: Pick<EnsControlPlaneService, "resolve">;
  executor?: TradeExecutor;
  now?: () => Date;
  id?: () => string;
};

export class ProofRunService {
  private readonly catalog: Pick<StockCatalogService, "assessTicker">;
  private readonly controlPlane: Pick<EnsControlPlaneService, "resolve">;
  private readonly executor: TradeExecutor;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(
    config: ApiConfig,
    private readonly store: StrategyStore,
    dependencies: Dependencies = {},
  ) {
    this.catalog = dependencies.catalog ?? new Catalog(config);
    this.controlPlane =
      dependencies.controlPlane ?? new ControlPlane(config);
    this.executor = dependencies.executor ?? disabledTradeExecutor;
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? randomUUID;
  }

  async run(input: {
    strategyId: string;
    amountIn: string;
    execute: boolean;
    userId: string;
    owner: EvmAddress;
    oneclaw: OneClawGate;
  }): Promise<TradeRun> {
    const strategy = this.store.strategy(input.strategyId, input.owner);
    const run: TradeRun = {
      id: this.id(),
      strategyId: input.strategyId,
      ticker: strategy?.ticker ?? "UNKNOWN",
      amountIn: input.amountIn,
      executeRequested: input.execute,
      status: "running",
      createdAt: this.timestamp(),
      steps: [],
      handoffs: [],
      oneclaw: input.oneclaw,
    };
    if (!strategy) return this.reject(run, "Strategy not found");
    if (strategy.status !== "active") {
      return this.reject(run, `Strategy is ${strategy.status}`);
    }
    if (
      BigInt(input.amountIn) > BigInt(strategy.maxAmountPerTrade) ||
      BigInt(strategy.spent) + BigInt(input.amountIn) >
        BigInt(strategy.maxTotalSpend)
    ) {
      return this.reject(run, "Amount exceeds strategy limits");
    }
    this.step(
      run,
      "strategy",
      "Strategy limits",
      "passed",
      "preview",
      "Ticker, amount, expiry and owner session are valid.",
    );

    const controlPlane = await this.controlPlane.resolve({
      userId: input.userId,
      owner: input.owner,
    });
    if (
      controlPlane.status !== "active" ||
      !controlPlane.manifest ||
      !controlPlane.manifestHash
    ) {
      return this.reject(
        run,
        controlPlane.error ?? "ENS fleet policy is not active",
      );
    }
    const manifest = controlPlane.manifest;
    run.handoffs.push(
      createHandoff({
        from: "ens",
        to: "scout",
        kind: "fleet-policy",
        mode: "live",
        payload: {
          manifestHash: controlPlane.manifestHash,
          version: manifest.version,
          policy: manifest.policy,
          paused: manifest.paused,
        },
        at: this.timestamp(),
      }),
    );
    if (manifest.paused) {
      return this.reject(run, "ENS fleet policy is paused");
    }
    if (!manifest.policy.allowedTickers.includes(strategy.ticker)) {
      return this.reject(run, `${strategy.ticker} is not allowed by ENS`);
    }
    if (
      BigInt(input.amountIn) >
      BigInt(manifest.policy.maxAmountPerTrade)
    ) {
      return this.reject(run, "Amount exceeds the ENS trade limit");
    }
    this.step(
      run,
      "ens",
      "ENS fleet policy",
      "passed",
      "live",
      `Policy v${manifest.version} resolved from ${controlPlane.rootName}.`,
      controlPlane.manifestHash,
    );

    const asset = await this.catalog.assessTicker(strategy.ticker);
    if (
      !asset ||
      asset.tokenAddress.toLowerCase() !==
        strategy.outputToken.toLowerCase()
    ) {
      return this.reject(run, "Robinhood asset contract does not match");
    }
    const marketFailure = marketRejection(asset, manifest.policy, this.now());
    if (marketFailure) return this.reject(run, marketFailure);

    const graph = asset.graphEvidence!;
    run.signal = {
      sourceAgent: "scout",
      side: "buy",
      confidence: Math.max(
        0,
        Math.min(1, 1 - (asset.deviationBps ?? 10_000) / 10_000),
      ),
      rationale:
        "ENS-approved candidate with a fresh Robinhood reference, Substreams evidence and an executable Uniswap route.",
      payment: { mode: "preview" },
    };
    run.handoffs.push(
      createHandoff({
        from: "scout",
        to: "risk",
        kind: "paid-signal",
        mode: "preview",
        payload: run.signal,
        at: this.timestamp(),
      }),
    );
    this.step(
      run,
      "scout",
      "Scout recommendation",
      "passed",
      "preview",
      "Candidate and supporting evidence were handed to Risk.",
    );

    run.market = {
      liquidityUsd: graph.liquidityUsd,
      lastSwapPrice: graph.lastSwapPrice,
      oraclePrice: asset.referencePrice!,
      graphMode: "live",
      blockNumber: graph.blockNumber,
      graphProvider: "the-graph-substreams",
      graphLagBlocks: graph.lagBlocks,
      graphPackage: graph.package,
      graphModule: graph.module,
      graphCheckpointBlock: graph.checkpointBlock,
      graphProcessedBlock: graph.processedBlock,
      graphHeadBlock: graph.providerHeadBlock,
      graphStartedAt: graph.startedAt,
      graphUpdatedAt: graph.updatedAt,
      poolAddress: graph.poolAddress,
      poolIdentifier: graph.poolIdentifier,
      transactionHash: graph.transactionHash,
      eventTopic: graph.topic,
      capturedAt: graph.capturedAt,
    };
    run.handoffs.push(
      createHandoff({
        from: "risk",
        to: "trader",
        kind: "risk-decision",
        mode: "live",
        payload: {
          market: run.market,
          deviationBps: asset.deviationBps,
          graphTransactionHash: graph.transactionHash,
        },
        at: this.timestamp(),
      }),
    );
    this.step(
      run,
      "risk",
      "Graph risk gate",
      "passed",
      "live",
      `Block ${graph.blockNumber} · liquidity $${graph.liquidityUsd.toLocaleString()} · lag ${graph.lagBlocks}.`,
      graph.transactionHash,
    );

    run.quote = {
      routing: asset.uniswapRouting!,
      quotedAmountOut: asset.quotedAmountOut!,
      requestId: asset.uniswapRequestId!,
      mode: "live",
    };
    let prepared;
    if (input.execute) {
      if (!input.oneclaw.executionAuthorized) {
        return this.reject(
          run,
          "Purchases of 3 USDG or more require the 1Claw trader rail",
        );
      }
      if (strategy.executionMode !== "full") {
        return this.reject(run, "Strategy is analysis-only");
      }
      if (
        input.oneclaw.required &&
        run.signal.payment.mode !== "live"
      ) {
        return this.reject(
          run,
          "Live x401 and x402 authorization is not configured",
        );
      }
      if (!this.executor.ready()) {
        return this.reject(
          run,
          "Live contract execution is not configured",
        );
      }
      prepared = await this.executor.prepare({
        strategy,
        amountIn: input.amountIn,
      });
      run.quote = {
        routing: prepared.routing,
        quotedAmountOut: prepared.amountOut,
        requestId: prepared.requestId,
        mode: "live",
      };
    }
    run.handoffs.push(
      createHandoff({
        from: "trader",
        to: "auditor",
        kind: "execution-intent",
        mode: "live",
        payload: {
          strategyId: strategy.id,
          amountIn: input.amountIn,
          quote: run.quote,
        },
        at: this.timestamp(),
      }),
    );
    this.step(
      run,
      "quote",
      "Uniswap V4 quote",
      "passed",
      "live",
      `${run.quote.routing} · output ${run.quote.quotedAmountOut}.`,
      run.quote.requestId,
    );

    if (input.execute) {
      const receipt = await this.executor.execute(
        {
          strategy,
          amountIn: input.amountIn,
          signalHash: hashPayload(run.signal),
        },
        prepared!,
      );
      run.transactionHash = receipt.transactionHash;
      run.quote = {
        routing: receipt.routing,
        quotedAmountOut: receipt.quotedAmountOut,
        requestId: receipt.requestId,
        mode: "live",
      };
      run.status = "executed";
      this.step(
        run,
        "execute",
        "Uniswap execution",
        "passed",
        "live",
        "The guarded purchase transaction was submitted.",
        run.transactionHash,
      );
    } else {
      run.status = "approved";
      this.step(
        run,
        "execute",
        "Execution",
        "passed",
        "preview",
        "Proof approved; no transaction was submitted.",
      );
    }
    return this.finalize(run);
  }

  private reject(run: TradeRun, reason: string): TradeRun {
    run.status = "rejected";
    run.rejectionReason = reason;
    this.step(run, "gate", "Policy gate", "blocked", "preview", reason);
    return this.finalize(run);
  }

  private finalize(run: TradeRun): TradeRun {
    run.handoffs.push(
      createHandoff({
        from: "auditor",
        to: "auditor",
        kind: "audit-bundle",
        mode: run.status === "executed" ? "live" : "preview",
        payload: {
          runId: run.id,
          status: run.status,
          transactionHash: run.transactionHash,
          handoffs: run.handoffs.map((handoff) => handoff.outputHash),
        },
        at: this.timestamp(),
      }),
    );
    run.proofBundleRoot = hashPayload(
      run.handoffs.map((handoff) => handoff.outputHash),
    );
    return this.store.saveRun(run);
  }

  private step(
    run: TradeRun,
    id: string,
    label: string,
    status: RunStep["status"],
    mode: ProofMode,
    detail: string,
    evidence?: string,
  ): void {
    run.steps.push({
      id,
      label,
      status,
      mode,
      detail,
      evidence,
      at: this.timestamp(),
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function marketRejection(
  asset: StockCatalogAsset,
  policy: {
    maxDeviationBps: number;
    minLiquidityUsd: number;
    maxOracleAgeSeconds: number;
  },
  now: Date,
): string | undefined {
  if (
    !asset.orchestrationReady ||
    !asset.referencePrice ||
    !asset.referenceUpdatedAt ||
    !asset.quotedAmountOut ||
    !asset.uniswapRequestId ||
    !asset.uniswapRouting ||
    !asset.graphEvidence?.healthy
  ) {
    return asset.reasons[0] ?? "Complete market evidence is unavailable";
  }
  if (
    asset.deviationBps === undefined ||
    asset.deviationBps > policy.maxDeviationBps
  ) {
    return "Uniswap price deviation exceeds ENS policy";
  }
  if (asset.graphEvidence.liquidityUsd < policy.minLiquidityUsd) {
    return "Indexed liquidity is below ENS policy";
  }
  if (
    now.getTime() - Date.parse(asset.referenceUpdatedAt) >
    policy.maxOracleAgeSeconds * 1_000
  ) {
    return "Robinhood reference price is stale";
  }
  return undefined;
}
