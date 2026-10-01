"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { markDecisionExecuted } from "../lib/goal-resume";
import {
  executeWalletBuy,
  previewWalletBuy,
  walletBuyApiCap,
  type WalletBuyPreview,
  type WalletBuyResult,
  type WalletBuyStage,
} from "../lib/wallet-buy";
import {
  walletBuyErrorMessage,
  WalletBuyError,
} from "../lib/wallet-buy-check";
import { useWalletAccess } from "./wallet-access-context";

export type WalletBuyState = {
  open: boolean;
  loading: boolean;
  busy: boolean;
  stage: WalletBuyStage;
  /** The per-order cap for this buy, in atomic USDG. */
  cap: bigint;
  /** False when the amount is above the cap. */
  allowed: boolean;
  preview?: WalletBuyPreview;
  result?: WalletBuyResult;
  error?: string;
  start: () => void;
  confirm: () => void;
  close: () => void;
};

/**
 * The "Buy from my wallet" path: the owner's own wallet signs the approval,
 * the Permit2 permission and the Uniswap buy. No vault, no agent key.
 */
export function useWalletBuy(input: {
  runId?: string;
  goalId?: string;
  ticker?: string;
  amountIn?: string;
  tokenOut?: `0x${string}`;
  /** The strategy's own per-trade limit, when there is one. */
  maxAmountPerTrade?: string;
}): WalletBuyState {
  const wallet = useWalletAccess();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<WalletBuyStage>("idle");
  const [preview, setPreview] = useState<WalletBuyPreview>();
  const [result, setResult] = useState<WalletBuyResult>();
  const [error, setError] = useState<string>();
  const request = useRef(0);

  const strategyCap =
    input.maxAmountPerTrade && /^[1-9]\d*$/.test(input.maxAmountPerTrade)
      ? BigInt(input.maxAmountPerTrade)
      : undefined;
  const cap =
    strategyCap !== undefined && strategyCap < walletBuyApiCap
      ? strategyCap
      : walletBuyApiCap;
  const allowed = Boolean(
    input.amountIn &&
      /^[1-9]\d*$/.test(input.amountIn) &&
      BigInt(input.amountIn) <= cap,
  );

  const load = useCallback(async () => {
    if (!input.ticker || !input.amountIn) return undefined;
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await previewWalletBuy({
        wallet,
        ticker: input.ticker,
        amountIn: input.amountIn,
        tokenOut: input.tokenOut,
        cap,
      });
      if (id === request.current) setPreview(next);
      return next;
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [cap, input.amountIn, input.ticker, input.tokenOut, wallet]);

  const start = useCallback(async () => {
    setOpen(true);
    setError(undefined);
    setResult(undefined);
    setPreview(undefined);
    try {
      await load();
    } catch (cause) {
      setError(walletBuyErrorMessage(cause));
    }
  }, [load]);

  const confirm = useCallback(async () => {
    if (!preview || busy || result) return;
    setBusy(true);
    setError(undefined);
    try {
      const completed = await executeWalletBuy({
        wallet,
        preview,
        onStage: setStage,
      });
      setResult(completed);
      if (input.goalId) markDecisionExecuted(preview.owner, input.goalId);
    } catch (cause) {
      setError(walletBuyErrorMessage(cause));
      // Show the new price so the owner can decide again with real numbers.
      if (cause instanceof WalletBuyError && cause.reason === "price_moved") {
        await load().catch(() => undefined);
      }
    } finally {
      setBusy(false);
      setStage("idle");
    }
  }, [busy, input.goalId, load, preview, result, wallet]);

  const close = useCallback(() => {
    if (busy) return;
    request.current += 1;
    setOpen(false);
    setLoading(false);
    setError(undefined);
  }, [busy]);

  useEffect(() => {
    request.current += 1;
    setOpen(false);
    setLoading(false);
    setBusy(false);
    setStage("idle");
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
  }, [input.runId]);

  return {
    open,
    loading,
    busy,
    stage,
    cap,
    allowed,
    preview,
    result,
    error,
    start: () => void start(),
    confirm: () => void confirm(),
    close,
  };
}
