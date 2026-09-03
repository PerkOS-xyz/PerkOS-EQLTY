"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  activateFleet,
  FleetRequestError,
  fundFleet,
  loadFleetSession,
  requestFleetChallenge,
  verifyFleetOwner,
} from "../lib/fleet-api";
import { authorizeFleetFunding } from "../lib/fleet-funding";
import type {
  FleetActivation,
  FleetFundingQuote,
  FleetFundingReceipt,
  FleetPhase,
  UserSession,
} from "../lib/fleet-types";
import { useWalletAccess } from "./wallet-access-context";

const coldStartWarmupMs = 20_000;

export type FleetActivationState = {
  activation?: FleetActivation;
  session?: UserSession;
  phase: FleetPhase;
  busy: boolean;
  fundingBusy: boolean;
  fundingPhase: "idle" | "authorizing" | "settling" | "activating";
  funding?: FleetFundingQuote;
  fundingReceipt?: FleetFundingReceipt;
  error?: string;
  activate: () => Promise<boolean>;
  fundAndRetry: () => Promise<boolean>;
  retry: () => void;
};

export function useFleetActivation(): FleetActivationState {
  const wallet = useWalletAccess();
  const activeRun = useRef(0);
  const startedFor = useRef<string | undefined>(undefined);
  const pendingOwnerProof = useRef<{
    address: `0x${string}`;
    nonce: string;
    signature: `0x${string}`;
  } | undefined>(undefined);
  const [activation, setActivation] = useState<FleetActivation>();
  const [session, setSession] = useState<UserSession>();
  const [phase, setPhase] = useState<FleetPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingPhase, setFundingPhase] = useState<
    FleetActivationState["fundingPhase"]
  >("idle");
  const [funding, setFunding] = useState<FleetFundingQuote>();
  const [fundingReceipt, setFundingReceipt] =
    useState<FleetFundingReceipt>();
  const [error, setError] = useState<string>();

  const begin = useCallback(async (): Promise<boolean> => {
    if (!wallet.connected || !wallet.address) {
      return false;
    }
    const run = activeRun.current + 1;
    activeRun.current = run;
    startedFor.current = wallet.address;
    setActivation(undefined);
    setFunding(undefined);
    setError(undefined);
    setBusy(true);
    setPhase("locating");

    try {
      let nextSession = await loadFleetSession();
      if (
        !nextSession ||
        nextSession.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
      ) {
        const challenge = await requestFleetChallenge(wallet.address);
        const signature = await wallet.signMessage(challenge.message);
        pendingOwnerProof.current = {
          address: wallet.address,
          nonce: challenge.nonce,
          signature,
        };
        if (activeRun.current !== run) {
          return false;
        }
        nextSession = await verifyFleetOwner(
          wallet.address,
          challenge.nonce,
          signature,
        );
        pendingOwnerProof.current = undefined;
      }
      setSession(nextSession);
      setPhase("creating");

      let nextActivation = await activateFleet();
      if (activeRun.current !== run) {
        return false;
      }
      const coldStart = fleetNeedsPolling(nextActivation);
      setActivation(nextActivation);
      setPhase(phaseFromActivation(nextActivation));

      for (
        let attempt = 0;
        attempt < 24 && fleetNeedsPolling(nextActivation);
        attempt += 1
      ) {
        await wait(5_000);
        if (activeRun.current !== run) {
          return false;
        }
        nextActivation = await activateFleet();
        setActivation(nextActivation);
        setPhase(phaseFromActivation(nextActivation));
      }
      const ready = !fleetNeedsPolling(nextActivation);
      if (ready && coldStart) {
        setPhase("waking");
        await wait(coldStartWarmupMs);
        if (activeRun.current !== run) {
          return false;
        }
        setPhase("ready");
      }
      return ready;
    } catch (cause) {
      if (activeRun.current !== run) {
        return false;
      }
      startedFor.current = undefined;
      if (
        cause instanceof FleetRequestError &&
        cause.status === 402 &&
        cause.code === "infra_payment_required" &&
        cause.funding
      ) {
        setFunding(cause.funding);
        setError(undefined);
      } else {
        setError(
          cause instanceof Error ? cause.message : "Fleet activation failed",
        );
      }
      setPhase("failed");
      return false;
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

  const fundAndRetry = useCallback(async (): Promise<boolean> => {
    if (!funding) return false;
    setFundingBusy(true);
    setFundingPhase("authorizing");
    setError(undefined);
    try {
      const payment = await authorizeFleetFunding({ wallet, quote: funding });
      setFundingPhase("settling");
      const receipt = await fundFleet(payment);
      setFundingReceipt(receipt);
      setFunding(undefined);
      const proof = pendingOwnerProof.current;
      if (
        proof &&
        wallet.address &&
        proof.address.toLowerCase() === wallet.address.toLowerCase()
      ) {
        const nextSession = await verifyFleetOwner(
          proof.address,
          proof.nonce,
          proof.signature,
        );
        setSession(nextSession);
        pendingOwnerProof.current = undefined;
      }
      setFundingPhase("activating");
      return await begin();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Fleet activation payment failed",
      );
      return false;
    } finally {
      setFundingBusy(false);
      setFundingPhase("idle");
    }
  }, [begin, funding, wallet]);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      activeRun.current += 1;
      startedFor.current = undefined;
      pendingOwnerProof.current = undefined;
      setActivation(undefined);
      setSession(undefined);
      setFunding(undefined);
      setFundingReceipt(undefined);
      setError(undefined);
      setBusy(false);
      setFundingBusy(false);
      setFundingPhase("idle");
      setPhase("idle");
      return;
    }
  }, [wallet.address, wallet.connected]);

  return {
    activation,
    session,
    phase,
    busy,
    fundingBusy,
    fundingPhase,
    funding,
    fundingReceipt,
    error,
    activate: begin,
    fundAndRetry,
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
