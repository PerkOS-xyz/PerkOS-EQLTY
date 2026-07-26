"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { readGoal, startGoal } from "../lib/goal-api";
import type { AutonomousGoal } from "../lib/goal-types";
import { useWalletAccess } from "./wallet-access-context";

const defaultGoal =
  "Find the strongest stock token opportunity within my policy and budget.";

export type GoalAnalysisState = {
  goalText: string;
  amount: string;
  windowMinutes: number;
  session?: AutonomousGoal;
  busy: boolean;
  error?: string;
  workflowError?: string;
  connected: boolean;
  runKey: number;
  setGoalText: (value: string) => void;
  setAmount: (value: string) => void;
  setWindowMinutes: (value: number) => void;
  analyze: () => void;
};

export function useGoalAnalysis(): GoalAnalysisState {
  const wallet = useWalletAccess();
  const activeRun = useRef(0);
  const [goalText, setGoalText] = useState(defaultGoal);
  const [amount, setAmount] = useState("1");
  const [windowMinutes, setWindowMinutes] = useState(2);
  const [session, setSession] = useState<AutonomousGoal>();
  const [runKey, setRunKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [workflowError, setWorkflowError] = useState<string>();

  const analyze = useCallback(async () => {
    if (!wallet.connected) {
      setError("Connect your wallet and wait for the fleet to come online.");
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
    setRunKey(run);
    setBusy(true);
    setError(undefined);
    setWorkflowError(undefined);
    setSession(undefined);

    try {
      const next = await startGoal({
        goal: goalText.trim(),
        amountIn: atomicAmount.toString(),
        windowMinutes,
        cadenceSeconds: 30,
        maxCandidates: 3,
      });
      if (activeRun.current === run) {
        setSession(next);
      }
    } catch (cause) {
      if (activeRun.current === run) {
        const message =
          cause instanceof Error ? cause.message : "Goal analysis failed";
        setError(message);
        setWorkflowError(message);
      }
    } finally {
      if (activeRun.current === run) {
        setBusy(false);
      }
    }
  }, [amount, goalText, wallet.connected, windowMinutes]);

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
      setError(undefined);
      setWorkflowError(undefined);
    }
  }, [wallet.connected]);

  return {
    goalText,
    amount,
    windowMinutes,
    session,
    busy,
    error,
    workflowError,
    connected: wallet.connected,
    runKey,
    setGoalText,
    setAmount,
    setWindowMinutes,
    analyze: () => void analyze(),
  };
}

export function parseUsdG(value: string): bigint | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(normalized)) {
    return undefined;
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}
