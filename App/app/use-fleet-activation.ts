"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  activateFleet,
  requestFleetChallenge,
  verifyFleetOwner,
} from "../lib/fleet-api";
import type {
  FleetActivation,
  FleetPhase,
  UserSession,
} from "../lib/fleet-types";
import { useWalletAccess } from "./wallet-access-context";

export type FleetActivationState = {
  activation?: FleetActivation;
  session?: UserSession;
  phase: FleetPhase;
  busy: boolean;
  error?: string;
  retry: () => void;
};

export function useFleetActivation(): FleetActivationState {
  const wallet = useWalletAccess();
  const activeRun = useRef(0);
  const startedFor = useRef<string | undefined>(undefined);
  const [activation, setActivation] = useState<FleetActivation>();
  const [session, setSession] = useState<UserSession>();
  const [phase, setPhase] = useState<FleetPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const begin = useCallback(async () => {
    if (!wallet.connected || !wallet.address) {
      return;
    }
    const run = activeRun.current + 1;
    activeRun.current = run;
    startedFor.current = wallet.address;
    setActivation(undefined);
    setError(undefined);
    setBusy(true);
    setPhase("locating");

    try {
      const challenge = await requestFleetChallenge(wallet.address);
      const signature = await wallet.signMessage(challenge.message);
      if (activeRun.current !== run) {
        return;
      }
      const nextSession = await verifyFleetOwner(
        wallet.address,
        challenge.nonce,
        signature,
      );
      setSession(nextSession);
      setPhase("creating");

      let nextActivation = await activateFleet();
      if (activeRun.current !== run) {
        return;
      }
      setActivation(nextActivation);
      setPhase(phaseFromActivation(nextActivation));

      for (
        let attempt = 0;
        attempt < 24 && fleetNeedsPolling(nextActivation);
        attempt += 1
      ) {
        await wait(5_000);
        if (activeRun.current !== run) {
          return;
        }
        nextActivation = await activateFleet();
        setActivation(nextActivation);
        setPhase(phaseFromActivation(nextActivation));
      }
    } catch (cause) {
      if (activeRun.current !== run) {
        return;
      }
      startedFor.current = undefined;
      setError(
        cause instanceof Error ? cause.message : "Fleet activation failed",
      );
      setPhase("failed");
    } finally {
      if (activeRun.current === run) {
        setBusy(false);
      }
    }
  }, [
    wallet.address,
    wallet.connected,
    wallet.signMessage,
  ]);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      activeRun.current += 1;
      startedFor.current = undefined;
      setActivation(undefined);
      setSession(undefined);
      setError(undefined);
      setBusy(false);
      setPhase("idle");
      return;
    }
    if (startedFor.current !== wallet.address) {
      void begin();
    }
  }, [begin, wallet.address, wallet.connected]);

  return {
    activation,
    session,
    phase,
    busy,
    error,
    retry: () => {
      startedFor.current = undefined;
      void begin();
    },
  };
}

function fleetNeedsPolling(activation: FleetActivation): boolean {
  return Boolean(
    activation.runtime &&
      activation.runtime.mode === "live" &&
      activation.runtime.agents.some((agent) =>
        ["planned", "provisioning", "waking"].includes(agent.state),
      ),
  );
}

function phaseFromActivation(activation: FleetActivation): FleetPhase {
  const agents = activation.runtime?.agents ?? [];
  if (agents.length > 0 && agents.every((agent) => agent.state === "ready")) {
    return "ready";
  }
  if (agents.some((agent) => agent.state === "failed")) {
    return "failed";
  }
  if (agents.some((agent) => agent.state === "waking")) {
    return "waking";
  }
  return "provisioning";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
