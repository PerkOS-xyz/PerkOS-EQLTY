"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  activateOneClawRails,
  ensManagerUrl,
  fleetMetadataUrl,
  loadFleetMetadata,
  oneclawAgentSettingsUrl,
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
  const trader = agents.find((agent) => agent.role === "trader");
  const executionLinked = trader?.oneclaw === "linked";
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState<string>();
  const [securityEmail, setSecurityEmail] = useState("");
  const [securityStarted, setSecurityStarted] = useState(false);
  const [oneclawAgentId, setOneclawAgentId] = useState<string>();
  useEffect(() => {
    setSecurityEmail(
      window.localStorage.getItem("eqlty_oneclaw_email") ?? "",
    );
    setOneclawAgentId(
      window.localStorage.getItem("eqlty_oneclaw_agent_id") ??
        undefined,
    );
  }, []);
  const canActivateSecurity = Boolean(
    runtime?.mode === "live" &&
      runtime.agents.length === fleetRoles.length &&
      runtime.agents.every(
        (agent) => agent.agentId && agent.state === "ready",
      ),
  );
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
            oneclawAgentId={
              agent.role === "trader" ? oneclawAgentId : undefined
            }
            phase={state.phase}
            rootName={state.activation?.rootName}
            runtimeAvailable={Boolean(runtime)}
          />
        ))}
      </div>

      {runtime?.mode === "live" && (
        <div
          aria-busy={securityBusy}
          className={`fleetSecurity ${
            executionLinked ? "linked" : ""
          }`}
        >
          <div className="fleetSecurityCopy">
            <span>1Claw execution rail</span>
            <strong>
              {executionLinked ? "Trader protected" : "Setup required"}
            </strong>
            <p>
              {executionLinked
                ? "The signing wallet and spending controls belong to your 1Claw account."
                : securityStarted
                  ? "Complete the 1Claw claim, then check the connection."
                  : "Create a user-owned wallet for the only agent allowed to spend."}
            </p>
          </div>
          {!executionLinked && (
            <form
              className="fleetSecurityActions"
              onSubmit={async (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                setSecurityBusy(true);
                setSecurityError(undefined);
                const claimTab = window.open(
                  "about:blank",
                  "_blank",
                  "noopener,noreferrer",
                );
                try {
                  const result =
                    await activateOneClawRails(securityEmail);
                  window.localStorage.setItem(
                    "eqlty_oneclaw_email",
                    securityEmail,
                  );
                  if ("executionAgent" in result) {
                    setOneclawAgentId(
                      result.executionAgent.oneclawAgentId,
                    );
                    window.localStorage.setItem(
                      "eqlty_oneclaw_agent_id",
                      result.executionAgent.oneclawAgentId,
                    );
                  }
                  setSecurityStarted(true);
                  const nextUrl =
                    result.status === "link_required"
                      ? result.authorizeUrl
                      : result.status === "claim_required"
                        ? result.claimUrl
                        : undefined;
                  if (claimTab && nextUrl) {
                    claimTab.location.href = nextUrl;
                  } else {
                    claimTab?.close();
                  }
                  if (result.status === "linked") state.retry();
                } catch (cause) {
                  claimTab?.close();
                  setSecurityError(
                    cause instanceof Error
                      ? cause.message
                      : "1Claw activation failed",
                  );
                } finally {
                  setSecurityBusy(false);
                }
              }}
            >
              <input
                aria-label="1Claw account email"
                autoComplete="email"
                onChange={(event) =>
                  setSecurityEmail(event.target.value)
                }
                placeholder="Your 1Claw email"
                required
                type="email"
                value={securityEmail}
              />
              <button
                disabled={
                  securityBusy || state.busy || !canActivateSecurity
                }
                type="submit"
              >
                {securityBusy
                  ? "Connecting"
                  : securityStarted
                    ? "Check connection"
                    : "Connect 1Claw"}
              </button>
            </form>
          )}
        </div>
      )}
      {securityError && (
        <div className="fleetError">
          <span>{securityError}</span>
        </div>
      )}
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
  oneclawAgentId,
  phase,
  rootName,
  runtimeAvailable,
}: {
  agent: FleetAgent;
  index: number;
  oneclawAgentId?: string;
  phase: FleetPhase;
  rootName?: string;
  runtimeAvailable: boolean;
}) {
  const visualPhase = runtimeAvailable
    ? agentStateToPhase(agent.state)
    : staggerPhase(phase, index);
  const completedSteps = stepProgress(visualPhase);

  return (
    <article
      className={`agentCard ${agent.state} ${
        agent.role === "trader" ? "hasOneclaw" : ""
      }`}
    >
      <span className="roleMark">
        <i />
      </span>
      {agent.role === "trader" && (
        <a
          aria-label="Open the trader settings in 1Claw"
          className={`oneclawAgentLink ${
            agent.oneclaw === "linked" ? "linked" : ""
          }`}
          href={oneclawAgentSettingsUrl(oneclawAgentId)}
          rel="noreferrer"
          target="_blank"
        >
          <img alt="" src="/1claw.png" />
        </a>
      )}
      <div className="agentIdentity">
        <strong>{agent.role}</strong>
        <small>{agent.name}</small>
        <p>{agent.plugins.join(" · ")}</p>
      </div>
      <div className="agentState">
        <b className={agent.state}>{agentPhaseCopy(visualPhase)}</b>
        <small>
          {agent.role !== "trader"
            ? "No spending authority"
            : agent.oneclaw === "linked"
              ? "1Claw protected"
              : "1Claw pending"}
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
