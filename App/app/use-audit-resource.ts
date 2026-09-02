"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadFleetSession,
  requestFleetChallenge,
  verifyFleetOwner,
} from "../lib/fleet-api";
import { useWalletAccess } from "./wallet-access-context";

export type AuditResource<T> = {
  data?: T;
  phase:
    | "disconnected"
    | "authenticating"
    | "loading"
    | "ready"
    | "error";
  error?: string;
  refresh: () => void;
};

export function useAuditResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
): AuditResource<T> {
  const wallet = useWalletAccess();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [request, setRequest] = useState(0);
  const [phase, setPhase] =
    useState<AuditResource<T>["phase"]>("disconnected");

  useEffect(() => {
    if (!wallet.loaded) {
      setPhase("loading");
      return;
    }
    if (!wallet.connected || !wallet.address) {
      setData(undefined);
      setError(undefined);
      setPhase("disconnected");
      return;
    }

    const controller = new AbortController();
    setError(undefined);
    setPhase("loading");
    const loadAuthenticated = async () => {
      const session = await loadFleetSession();
      if (
        !session ||
        session.walletAddress.toLowerCase() !==
          wallet.address!.toLowerCase()
      ) {
        setPhase("authenticating");
        const challenge = await requestFleetChallenge(wallet.address!);
        const signature = await walletRef.current.signMessage(
          challenge.message,
        );
        await verifyFleetOwner(
          wallet.address!,
          challenge.nonce,
          signature,
        );
        if (!controller.signal.aborted) setPhase("loading");
      }
      return loader(controller.signal);
    };

    loadAuthenticated()
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setPhase("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Audit data unavailable",
          );
          setPhase("error");
        }
      });
    return () => controller.abort();
  }, [
    loader,
    request,
    wallet.address,
    wallet.connected,
    wallet.loaded,
  ]);

  const refresh = useCallback(() => {
    setRequest((value) => value + 1);
  }, []);

  return { data, phase, error, refresh };
}
