"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  createExecutionStrategy,
  linkExecutionStrategy,
  readExecutionConfig,
  robinhoodUsdG,
  startProofRun,
  universalRouter,
} from "../lib/execution-api";
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
  acknowledged: boolean;
  error?: string;
  runProof: () => void;
  executePurchase: () => void;
  setAcknowledged: (value: boolean) => void;
};

export function useProofRun(session?: AutonomousGoal): ProofRunState {
  const wallet = useWalletAccess();
  const [strategy, setStrategy] = useState<ExecutionStrategy>();
  const [run, setRun] = useState<TradeRun>();
  const [proofBusy, setProofBusy] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseStage, setPurchaseStage] =
    useState<PurchaseStage>("idle");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string>();

  const runProof = useCallback(async () => {
    const winner = recommendedCandidate(session);
    if (!session || !winner?.tokenAddress || !wallet.address) {
      setError("A connected wallet and an executable candidate are required.");
      return;
    }
    setProofBusy(true);
    setAcknowledged(false);
    setError(undefined);
    setRun(undefined);

    try {
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
      setRun(await startProofRun(nextStrategy, session.amountIn, false));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proof run failed");
    } finally {
      setProofBusy(false);
    }
  }, [session, wallet.address]);

  const executePurchase = useCallback(async () => {
    if (
      !strategy ||
      !run ||
      run.status !== "approved" ||
      !acknowledged
    ) {
      setError("Complete the proof and confirm the live purchase first.");
      return;
    }
    if (!run.oneclaw.executionAuthorized) {
      setError(
        "Purchases of 3 USDG or more require every 1Claw fleet rail.",
      );
      return;
    }

    setPurchaseBusy(true);
    setPurchaseStage("checking");
    setError(undefined);
    try {
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
        if (
          config.contracts.trader &&
          config.contracts.trader.toLowerCase() !==
            activeStrategy.agent.toLowerCase()
        ) {
          throw new Error("The configured Hermes trader does not match");
        }
        const onchain = await provisionWalletStrategy({
          wallet,
          strategy: activeStrategy,
          vault: config.contracts.eqltyVault,
          amountIn: run.amountIn,
          onStage: setPurchaseStage,
        });
        setPurchaseStage("linking");
        activeStrategy = await linkExecutionStrategy(
          activeStrategy,
          onchain,
        );
        setStrategy(activeStrategy);
      }
      setPurchaseStage("executing");
      setRun(await startProofRun(activeStrategy, run.amountIn, true));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Purchase execution failed",
      );
    } finally {
      setPurchaseBusy(false);
      setPurchaseStage("idle");
    }
  }, [acknowledged, run, strategy, wallet]);

  useEffect(() => {
    setStrategy(undefined);
    setRun(undefined);
    setAcknowledged(false);
    setPurchaseStage("idle");
    setError(undefined);
  }, [session?.id]);

  return {
    run,
    strategy,
    proofBusy,
    purchaseBusy,
    purchaseStage,
    acknowledged,
    error,
    runProof: () => void runProof(),
    executePurchase: () => void executePurchase(),
    setAcknowledged,
  };
}

function recommendedCandidate(session?: AutonomousGoal) {
  return session?.latest?.candidates.find(
    (candidate) => candidate.status === "recommended",
  );
}
