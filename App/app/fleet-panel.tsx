"use client";

import { useState } from "react";
import {
  ensManagerUrl,
  fleetMetadataUrl,
  loadFleetMetadata,
} from "../lib/fleet-api";
import type {
  AgentState,
  EnsAgentMetadata,
  FleetAgent,
  FleetPhase,
} from "../lib/fleet-types";
import { fleetRoles } from "../lib/fleet-types";
import { useWalletAccess } from "./wallet-access-context";
import { useFleetActivation } from "./use-fleet-activation";

const steps = ["Locate", "Create", "Provision", "Wake"];

export function FleetPanel() {
  const wallet = useWalletAccess();
  const state = useFleetActivation();
  const runtime = state.activation?.runtime;
  const suffix = (
    state.session?.fleetUserId ??
    state.activation?.userId ??
    "pending"
  )
    .replace(/^u-/, "")
    .slice(0, 8);
  const runtimeByRole = new Map(
    runtime?.agents.map((agent) => [agent.role, agent]),
  );
  const agents = fleetRoles.map((definition) => {
    const current = runtimeByRole.get(definition.role);
    return (
      current ?? {
        ...definition,
        name: `eqlty-${definition.role}-${suffix}`,
        runtime: "Hermes" as const,
        state: phaseToAgentState(state.phase),
        oneclaw: "pending-agent-credential" as const,
      }
    );
  });
  const readyCount = agents.filter((agent) => agent.state === "ready").length;
  const displayState =
    state.phase === "ready"
      ? "ready"
      : state.phase === "failed"
        ? "failed"
        : state.phase === "idle"
          ? "idle"
          : "working";

  return (
    <section
      aria-busy={state.busy}
      aria-live="polite"
      className={`fleet fleetRuntime ${state.busy ? "isActivating" : ""}`}
    >
      <header className="fleetHeader runtimeHeader">
        <div>
          <span className="eyebrow">PerkOS infrastructure</span>
          <h2>Your Hermes fleet</h2>
          <p className="fleetCopy">
            {fleetHeadline(state.phase, wallet.connected)}
          </p>
        </div>
        <b className={`fleetCount ${displayState}`}>
          {displayState === "ready"
            ? "4/4 ready"
            : `${readyCount}/4 online`}
        </b>
      </header>

      <div aria-hidden="true" className="fleetProgress">
        <i
          style={{
            width: `${displayState === "ready" ? 100 : Math.max(8, readyCount * 25)}%`,
          }}
        />
      </div>

      <div className="fleetGrid runtimeGrid">
        {agents.map((agent, index) => (
          <AgentCard
            agent={agent}
            index={index}
            key={agent.role}
            phase={state.phase}
            rootName={state.activation?.rootName}
            runtimeAvailable={Boolean(runtime)}
          />
        ))}
      </div>

      {!wallet.connected && (
        <p className="fleetNote">
          Connect your wallet to locate or create its agent fleet.
        </p>
      )}
      {state.busy && (
        <p className="fleetNote">
          Keep this tab open while managed runtime health is checked.
        </p>
      )}
      {runtime && runtime.mode !== "live" && (
        <p className="fleetNote">
          Runtime provisioning is currently in {runtime.mode} mode.
        </p>
      )}
      {state.error && (
        <div className="fleetError">
          <span>{state.error}</span>
          <button onClick={state.retry} type="button">
            Try again
          </button>
        </div>
      )}
    </section>
  );
}

function AgentCard({
  agent,
  index,
  phase,
  rootName,
  runtimeAvailable,
}: {
  agent: FleetAgent;
  index: number;
  phase: FleetPhase;
  rootName?: string;
  runtimeAvailable: boolean;
}) {
  const visualPhase = runtimeAvailable
    ? agentStateToPhase(agent.state)
    : staggerPhase(phase, index);
  const completedSteps = stepProgress(visualPhase);

  return (
    <article className={`agentCard ${agent.state}`}>
      <span className="roleMark">
        <i />
      </span>
      <div className="agentIdentity">
        <strong>{agent.role}</strong>
        <small>{agent.name}</small>
        <p>{agent.plugins.join(" · ")}</p>
      </div>
      <div className="agentState">
        <b className={agent.state}>{agentPhaseCopy(visualPhase)}</b>
        <small>
          {agent.oneclaw === "linked"
            ? "1Claw configured"
            : "Security pending"}
        </small>
      </div>
      {runtimeAvailable && (
        <AgentMetadata role={agent.role} rootName={rootName} />
      )}
      <ol
        aria-label={`${agent.role} runtime progress`}
        className="agentSteps"
      >
        {steps.map((step, stepIndex) => (
          <li
            className={
              stepIndex < completedSteps
                ? "complete"
                : stepIndex === completedSteps
                  ? "active"
                  : ""
            }
            key={step}
          >
            <i />
            {step}
          </li>
        ))}
      </ol>
    </article>
  );
}

function AgentMetadata({
  role,
  rootName,
}: {
  role: FleetAgent["role"];
  rootName?: string;
}) {
  const [metadata, setMetadata] = useState<EnsAgentMetadata>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (metadata || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      setMetadata(await loadFleetMetadata(role));
    } catch {
      setError("ENS metadata is still syncing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="agentMetadata">
      <div className="agentMetadataActions">
        <button aria-expanded={open} onClick={toggle} type="button">
          {open ? "Hide settings" : "View settings"}
        </button>
        {rootName && (
          <a
            href={ensManagerUrl(`${role}.${rootName}`)}
            rel="noreferrer"
            target="_blank"
          >
            View on ENS
          </a>
        )}
        <a href={fleetMetadataUrl(role)} rel="noreferrer" target="_blank">
          Inspect metadata JSON
        </a>
      </div>
      {open && loading && <small>Loading active ENS settings</small>}
      {open && error && <small>{error}</small>}
      {open && metadata && (
        <dl>
          <div>
            <dt>ENS name</dt>
            <dd>{metadata.name}</dd>
          </div>
          <div>
            <dt>Objective</dt>
            <dd>{metadata.settings.behavior.objective}</dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>
              {metadata.settings.behavior.inputs.join(", ")} ·{" "}
              {metadata.settings.behavior.actions.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Security</dt>
            <dd>{metadata.settings.security.enforcement}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function phaseToAgentState(phase: FleetPhase): AgentState {
  if (phase === "ready") return "ready";
  if (phase === "waking") return "waking";
  if (phase === "failed") return "failed";
  if (phase === "creating" || phase === "provisioning") {
    return "provisioning";
  }
  return "planned";
}

function agentStateToPhase(state: AgentState): FleetPhase {
  if (state === "ready") return "ready";
  if (state === "waking") return "waking";
  if (state === "provisioning") return "provisioning";
  if (state === "failed") return "failed";
  return "locating";
}

function staggerPhase(phase: FleetPhase, index: number): FleetPhase {
  const phases: FleetPhase[] = [
    "idle",
    "locating",
    "creating",
    "provisioning",
    "waking",
    "ready",
  ];
  const current = Math.max(0, phases.indexOf(phase));
  return phases[Math.max(0, current - Math.floor(index / 2))] ?? "idle";
}

function stepProgress(phase: FleetPhase): number {
  return {
    idle: -1,
    locating: 0,
    creating: 1,
    provisioning: 2,
    waking: 3,
    ready: 4,
    failed: -1,
  }[phase];
}

function fleetHeadline(phase: FleetPhase, connected: boolean): string {
  if (!connected) return "Connect your wallet to begin";
  return {
    idle: "Preparing fleet activation",
    locating: "Looking for your existing agents",
    creating: "Creating missing agent identities",
    provisioning: "Provisioning isolated Hermes runtimes",
    waking: "Waking runtimes and checking health",
    ready: "Four secure runtimes are online",
    failed: "Fleet activation needs attention",
  }[phase];
}

function agentPhaseCopy(phase: FleetPhase): string {
  return {
    idle: "Waiting",
    locating: "Locating",
    creating: "Creating",
    provisioning: "Provisioning",
    waking: "Waking up",
    ready: "Online",
    failed: "Failed",
  }[phase];
}
