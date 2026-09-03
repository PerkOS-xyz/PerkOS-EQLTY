"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  createExecutionStrategy,
  linkExecutionStrategy,
  recoverExecutionStrategy,
  readExecutionConfig,
  readWalletReadiness,
  robinhoodUsdG,
  startProofRun,
  universalRouter,
} from "../lib/execution-api";
import type { WalletReadiness } from "../lib/execution-api";
import type { ExecutionConfig } from "../lib/execution-api";
import {
  provisionWalletStrategy,
  type PurchaseStage,
} from "../lib/eqlty-vault";
import type {
  ExecutionStrategy,
  TradeRun,
} from "../lib/execution-types";
import type { AutonomousGoal } from "../lib/goal-types";
import { useWalletAccess } from "./wallet-access-context";

export type ProofRunState = {
  run?: TradeRun;
  strategy?: ExecutionStrategy;
  proofBusy: boolean;
  purchaseBusy: boolean;
  purchaseStage: PurchaseStage;
  reviewOpen: boolean;
  reviewBusy: boolean;
  readiness?: WalletReadiness;
  execution?: ExecutionConfig["execution"];
  acknowledged: boolean;
  awaitingFunding?: "proof" | "purchase";
  error?: string;
  runProof: () => void;
  executePurchase: () => void;
  openReview: () => void;
  closeReview: () => void;
  setAcknowledged: (value: boolean) => void;
};

export function useProofRun(
  session?: AutonomousGoal,
  ensureFleetReady?: () => Promise<boolean>,
): ProofRunState {
  const wallet = useWalletAccess();
  const [strategy, setStrategy] = useState<ExecutionStrategy>();
  const [run, setRun] = useState<TradeRun>();
  const [proofBusy, setProofBusy] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseStage, setPurchaseStage] =
    useState<PurchaseStage>("idle");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [readiness, setReadiness] = useState<WalletReadiness>();
  const [execution, setExecution] =
    useState<ExecutionConfig["execution"]>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [awaitingFunding, setAwaitingFunding] = useState<
    ProofRunState["awaitingFunding"]
  >();
  const [error, setError] = useState<string>();

  const runProof = useCallback(async () => {
    const winner = recommendedCandidate(session);
    if (!session || !winner?.tokenAddress || !wallet.address) {
      setError("A connected wallet and an executable candidate are required.");
      return;
    }
    setProofBusy(true);
    setAcknowledged(false);
    setAwaitingFunding(undefined);
    setError(undefined);
    setRun(undefined);

    try {
      if (ensureFleetReady && !(await ensureFleetReady())) {
        setAwaitingFunding("proof");
        setError("Add PerkOS compute credit to verify the purchase plan.");
        return;
      }
      const nextStrategy = await createExecutionStrategy({
        owner: wallet.address,
        agent: wallet.address,
        ticker: winner.ticker,
        inputToken: robinhoodUsdG,
        outputToken: winner.tokenAddress,
        router: universalRouter,
        maxAmountPerTrade: session.amountIn,
        maxTotalSpend: session.amountIn,
        maxSlippageBps: 100,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        humanVerified: true,
      });
      setStrategy(nextStrategy);
      const proof = await startProofRun(
        session.id,
        nextStrategy,
        session.amountIn,
        false,
      );
      const fundedStrategy = await recoverExecutionStrategy(
        nextStrategy,
      ).catch(() => undefined);
      setStrategy(fundedStrategy ?? nextStrategy);
      setRun(proof);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proof run failed");
    } finally {
      setProofBusy(false);
    }
  }, [ensureFleetReady, session, wallet.address]);

  const executePurchase = useCallback(async () => {
    if (
      !strategy ||
      !run ||
      !session ||
      run.status !== "approved" ||
      !acknowledged ||
      !readiness?.ready
    ) {
      setError("Complete the proof and confirm the live purchase first.");
      return;
    }
    if (!run.oneclaw.executionAuthorized) {
      setError(
        "Purchases of 3 USDG or more require the 1Claw trader rail.",
      );
      return;
    }

    setPurchaseBusy(true);
    setPurchaseStage("checking");
    setAwaitingFunding(undefined);
    setError(undefined);
    try {
      if (ensureFleetReady && !(await ensureFleetReady())) {
        setAwaitingFunding("purchase");
        setError("Add PerkOS compute credit to execute this purchase.");
        return;
      }
      let activeStrategy = strategy;
      if (!activeStrategy.onchain) {
        const config = await readExecutionConfig();
        if (
          config.network.chainId !== 4663 ||
          !config.contracts.eqltyVault
        ) {
          throw new Error(
            "Wallet strategy funding is not configured on Robinhood Chain",
          );
        }
        const onchain = await provisionWalletStrategy({
          wallet,
          strategy: activeStrategy,
          vault: config.contracts.eqltyVault,
          amountIn: run.amountIn,
          onStage: setPurchaseStage,
        });
        setPurchaseStage("linking");
        activeStrategy = { ...activeStrategy, onchain };
        setStrategy(activeStrategy);
        activeStrategy = await linkExecutionStrategy(
          activeStrategy,
          onchain,
        );
        setStrategy(activeStrategy);
      }
      setPurchaseStage("executing");
      setRun(
        await startProofRun(
          session.id,
          activeStrategy,
          run.amountIn,
          true,
        ),
      );
      setReviewOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Purchase execution failed",
      );
    } finally {
      setPurchaseBusy(false);
      setPurchaseStage("idle");
    }
  }, [
    acknowledged,
    ensureFleetReady,
    readiness?.ready,
    run,
    session,
    strategy,
    wallet,
  ]);

  const openReview = useCallback(async () => {
    if (!run || run.status !== "approved") return;
    setReviewOpen(true);
    setReviewBusy(true);
    setAcknowledged(false);
    setAwaitingFunding(undefined);
    setReadiness(undefined);
    setExecution(undefined);
    setError(undefined);
    try {
      const [walletReadiness, config] = await Promise.all([
        readWalletReadiness(run.amountIn),
        readExecutionConfig(),
      ]);
      const executionReady =
        config.execution.status === "ready" &&
        config.execution.decisionAuthorization === "live" &&
        (!run.oneclaw.required ||
          config.execution.protectedPurchases === "enabled");
      setExecution(config.execution);
      setReadiness(
        strategy?.onchain
          ? {
              ...walletReadiness,
              ready: walletReadiness.checks.vault && executionReady,
              checks: {
                ...walletReadiness.checks,
                funds: true,
                gas: true,
              },
            }
          : {
              ...walletReadiness,
              ready: walletReadiness.ready && executionReady,
            },
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Wallet readiness check failed",
      );
    } finally {
      setReviewBusy(false);
    }
  }, [run, strategy?.onchain]);

  const closeReview = useCallback(() => {
    if (purchaseBusy) return;
    setReviewOpen(false);
    setAcknowledged(false);
    setError(undefined);
  }, [purchaseBusy]);

  useEffect(() => {
    setStrategy(undefined);
    setRun(undefined);
    setAcknowledged(false);
    setAwaitingFunding(undefined);
    setPurchaseStage("idle");
    setReviewOpen(false);
    setReviewBusy(false);
    setReadiness(undefined);
    setExecution(undefined);
    setError(undefined);
  }, [session?.id]);

  return {
    run,
    strategy,
    proofBusy,
    purchaseBusy,
    purchaseStage,
    reviewOpen,
    reviewBusy,
    readiness,
    execution,
    acknowledged,
    awaitingFunding,
    error,
    runProof: () => void runProof(),
    executePurchase: () => void executePurchase(),
    openReview: () => void openReview(),
    closeReview,
    setAcknowledged,
  };
}

function recommendedCandidate(session?: AutonomousGoal) {
  return session?.latest?.candidates.find(
    (candidate) => candidate.status === "recommended",
  );
}
