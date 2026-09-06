"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadFleetPolicy } from "../lib/fleet-api";
import type { FleetPolicy } from "../lib/fleet-types";
import {
  loadIntegrationHealth,
  type GraphIntegrationHealth,
} from "../lib/market-api";
import { authorizeDecisionFee } from "../lib/decision-fee";
import {
  goalDecisionFeeResource,
  readDecisionFeeConfig,
  readGoal,
  settleGoalDecisionFee,
  startGoal,
} from "../lib/goal-api";
import type { DecisionFeeConfig } from "../lib/goal-api";
import type {
  AutonomousGoal,
  FinancialGoalProfile,
} from "../lib/goal-types";
import { useWalletAccess } from "./wallet-access-context";

const defaultGoal =
  "Compare policy-compatible Stock Tokens for a long-term growth goal.";

const defaultProfile: FinancialGoalProfile = {
  purpose: "long-term-growth",
  horizonMonths: 36,
  liquidityNeed: "can-commit",
  riskComfort: "medium",
};

export type GoalAnalysisState = {
  goalText: string;
  amount: string;
  windowMinutes: number;
  candidateTicker: string;
  profile: FinancialGoalProfile;
  policy?: FleetPolicy;
  policyLoading: boolean;
  policyError?: string;
  graphHealth?: GraphIntegrationHealth;
  graphHealthLoading: boolean;
  graphHealthError?: string;
  feeConfig?: DecisionFeeConfig;
  session?: AutonomousGoal;
  busy: boolean;
  paymentBusy: boolean;
  paymentPhase: "idle" | "authorizing" | "settling";
  error?: string;
  workflowError?: string;
  connected: boolean;
  runKey: number;
  setGoalText: (value: string) => void;
  setAmount: (value: string) => void;
  setWindowMinutes: (value: number) => void;
  setCandidateTicker: (value: string) => void;
  setProfile: (value: FinancialGoalProfile) => void;
  refreshGraphHealth: () => void;
  analyze: () => void;
  payDecisionFee: () => void;
};

export function useGoalAnalysis(
  ensureFleetReady?: () => Promise<boolean>,
): GoalAnalysisState {
  const wallet = useWalletAccess();
  const activeRun = useRef(0);
  const [goalText, setGoalText] = useState(defaultGoal);
  const [amount, setAmount] = useState("1");
  const [windowMinutes, setWindowMinutes] = useState(2);
  const [candidateTicker, setCandidateTicker] = useState("");
  const [profile, setProfile] =
    useState<FinancialGoalProfile>(defaultProfile);
  const [policy, setPolicy] = useState<FleetPolicy>();
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string>();
  const [graphHealth, setGraphHealth] = useState<GraphIntegrationHealth>();
  const [graphHealthLoading, setGraphHealthLoading] = useState(true);
  const [graphHealthError, setGraphHealthError] = useState<string>();
  const [feeConfig, setFeeConfig] = useState<DecisionFeeConfig>();
  const [policyRevision, setPolicyRevision] = useState(0);
  const [session, setSession] = useState<AutonomousGoal>();
  const [runKey, setRunKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState<
    GoalAnalysisState["paymentPhase"]
  >("idle");
  const [error, setError] = useState<string>();
  const [workflowError, setWorkflowError] = useState<string>();

  const refreshGraphHealth = useCallback(async () => {
    setGraphHealthLoading(true);
    setGraphHealthError(undefined);
    try {
      const next = await loadIntegrationHealth();
      setGraphHealth(next);
      return next;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Onchain evidence readiness is unavailable";
      setGraphHealth(undefined);
      setGraphHealthError(message);
      return undefined;
    } finally {
      setGraphHealthLoading(false);
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!wallet.connected) {
      setError("Connect your wallet to begin a private consultation.");
      return;
    }
    const atomicAmount = parseUsdG(amount);
    if (atomicAmount === undefined || atomicAmount <= 0n) {
      setError("Enter a valid positive USDG budget.");
      return;
    }
    if (goalText.trim().length < 10) {
      setError("Describe the investment goal in a little more detail.");
      return;
    }

    const run = activeRun.current + 1;
    activeRun.current = run;
    setRunKey(0);
    setBusy(true);
    setError(undefined);
    setWorkflowError(undefined);
    setSession(undefined);

    let workflowStarted = false;
    try {
      const evidence = await refreshGraphHealth();
      if (!evidence || evidence.status !== "ready") {
        setError(graphReadinessMessage(evidence));
        return;
      }
      if (ensureFleetReady && !(await ensureFleetReady())) {
        return;
      }
      setRunKey(run);
      workflowStarted = true;
      const next = await startGoal({
        goal: goalText.trim(),
        profile,
        amountIn: atomicAmount.toString(),
        windowMinutes,
        cadenceSeconds: 30,
        maxCandidates: candidateTicker
          ? 1
          : Math.min(10, policy?.allowedTickers.length ?? 3),
        candidateTickers: candidateTicker
          ? [candidateTicker]
          : undefined,
      });
      if (activeRun.current === run) {
        setSession(next);
      }
    } catch (cause) {
      if (activeRun.current === run) {
        const message =
          cause instanceof Error ? cause.message : "Goal analysis failed";
        setError(message);
        setWorkflowError(workflowStarted ? message : undefined);
      }
    } finally {
      if (activeRun.current === run) {
        setBusy(false);
      }
    }
  }, [
    amount,
    candidateTicker,
    ensureFleetReady,
    goalText,
    policy?.allowedTickers.length,
    profile,
    refreshGraphHealth,
    wallet.connected,
    windowMinutes,
  ]);

  const payDecisionFee = useCallback(async () => {
    const fee = session?.decisionFee;
    if (
      !session ||
      fee?.status !== "payment-required" ||
      !fee.requirements
    ) {
      setError("This decision has no payable x402 request.");
      return;
    }
    setPaymentBusy(true);
    setPaymentPhase("authorizing");
    setError(undefined);
    try {
      const payment = await authorizeDecisionFee({
        wallet,
        goalId: session.id,
        requirements: fee.requirements,
        resourceUrl: goalDecisionFeeResource(session.id),
      });
      setPaymentPhase("settling");
      const settled = await settleGoalDecisionFee(session.id, payment);
      setSession(settled);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Decision fee settlement failed",
      );
    } finally {
      setPaymentBusy(false);
      setPaymentPhase("idle");
    }
  }, [session, wallet]);

  useEffect(() => {
    void readDecisionFeeConfig()
      .then(setFeeConfig)
      .catch(() => undefined);
    void refreshGraphHealth();
  }, [refreshGraphHealth]);

  useEffect(() => {
    const refresh = () => setPolicyRevision((current) => current + 1);
    window.addEventListener("eqlty:policy-published", refresh);
    return () =>
      window.removeEventListener("eqlty:policy-published", refresh);
  }, []);

  useEffect(() => {
    if (!wallet.connected) {
      setPolicy(undefined);
      setPolicyLoading(false);
      setPolicyError(undefined);
      setCandidateTicker("");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    setPolicyLoading(true);
    setPolicyError(undefined);

    const load = async () => {
      attempts += 1;
      try {
        const next = await loadFleetPolicy();
        if (cancelled) return;
        setPolicy(next);
        setCandidateTicker((current) =>
          next.allowedTickers.includes(current) ? current : "",
        );
        setPolicyError(undefined);
        setPolicyLoading(false);
      } catch (cause) {
        if (cancelled) return;
        if (attempts < 6) {
          timer = window.setTimeout(load, 2_000);
          return;
        }
        setPolicyLoading(false);
        setPolicyError(
          cause instanceof Error
            ? cause.message
            : "ENS policy is unavailable",
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [policyRevision, wallet.connected]);

  useEffect(() => {
    if (!session || session.status !== "active") {
      return;
    }
    const controller = new AbortController();
    const goalId = session.id;
    const run = activeRun.current;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await readGoal(goalId, controller.signal);
        if (activeRun.current !== run) {
          return;
        }
        setError(undefined);
        setWorkflowError(undefined);
        setSession(next);
        if (next.status === "active") {
          timer = window.setTimeout(poll, 5_000);
        }
      } catch (cause) {
        if (!controller.signal.aborted && activeRun.current === run) {
          const message =
            cause instanceof Error ? cause.message : "Goal refresh failed";
          setError(message);
          setWorkflowError(message);
        }
      }
    };

    timer = window.setTimeout(poll, 5_000);
    return () => {
      controller.abort();
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [session?.id, session?.status]);

  useEffect(() => {
    if (!wallet.connected) {
      activeRun.current += 1;
      setSession(undefined);
      setRunKey(0);
      setBusy(false);
      setPaymentBusy(false);
      setPaymentPhase("idle");
      setError(undefined);
      setWorkflowError(undefined);
    }
  }, [wallet.connected]);

  return {
    goalText,
    amount,
    windowMinutes,
    candidateTicker,
    profile,
    policy,
    policyLoading,
    policyError,
    graphHealth,
    graphHealthLoading,
    graphHealthError,
    feeConfig,
    session,
    busy,
    paymentBusy,
    paymentPhase,
    error,
    workflowError,
    connected: wallet.connected,
    runKey,
    setGoalText,
    setAmount,
    setWindowMinutes,
    setCandidateTicker,
    setProfile,
    refreshGraphHealth: () => void refreshGraphHealth(),
    analyze: () => void analyze(),
    payDecisionFee: () => void payDecisionFee(),
  };
}

function graphReadinessMessage(
  health?: GraphIntegrationHealth,
): string {
  if (!health) {
    return "Onchain evidence readiness could not be verified. No agents were started and no fee was requested.";
  }
  if (health.reason === "quota-exhausted") {
    return "The selected evidence provider quota is exhausted. No agents were started and no fee was requested.";
  }
  if (health.reason === "lagging") {
    return "Onchain evidence is still catching up. No agents were started and no fee was requested.";
  }
  return "Onchain evidence is unavailable. No agents were started and no fee was requested.";
}

export function parseUsdG(value: string): bigint | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(normalized)) {
    return undefined;
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}
