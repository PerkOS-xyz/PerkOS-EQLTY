"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  activateOneClawRails,
  ensManagerUrl,
  fleetMetadataUrl,
  loadFleetMetadata,
  loadOneClawIntegrationHealth,
  loadOneClawUserConnection,
  loadFleetPolicy,
  oneclawAgentSettingsUrl,
  publishDemoFleetPolicy,
} from "../lib/fleet-api";
import type {
  AgentRole,
  AgentState,
  EnsAgentMetadata,
  FleetAgent,
  FleetPhase,
  OneClawIntegrationHealth,
  OneClawUserConnection,
} from "../lib/fleet-types";
import { fleetRoles } from "../lib/fleet-types";
import {
  connectorState,
  policyChecks,
  policyResultLabel,
  roleWorkflowState,
  workflowFromGoal,
  workflowHeadline,
  workflowStateCopy,
  workflowTechnologySteps,
  type FleetWorkflow,
  type WorkflowState,
} from "./fleet-workflow";
import type { GoalAnalysisState } from "./use-goal-analysis";
import { useWalletAccess } from "./wallet-access-context";
import type { FleetActivationState } from "./use-fleet-activation";

const steps = ["Locate", "Create", "Provision", "Wake"];

export function FleetPanel({
  fleet: state,
  goal,
  showFundingAction = true,
}: {
  fleet: FleetActivationState;
  goal: GoalAnalysisState;
  showFundingAction?: boolean;
}) {
  const wallet = useWalletAccess();
  const workflow = workflowFromGoal(goal);
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
  const credentialInstalled = trader?.oneclaw === "linked";
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState<string>();
  const [securityEmail, setSecurityEmail] = useState("");
  const [securityStarted, setSecurityStarted] = useState(false);
  const [oneclawAgentId, setOneclawAgentId] = useState<string>();
  const [oneclawHealth, setOneclawHealth] =
    useState<OneClawIntegrationHealth>();
  const [oneclawConnection, setOneclawConnection] =
    useState<OneClawUserConnection>();
  const executionLinked = Boolean(
    credentialInstalled && oneclawConnection?.status === "active",
  );
  useEffect(() => {
    const owner = state.session?.walletAddress;
    if (!owner) {
      setSecurityEmail("");
      setOneclawAgentId(undefined);
      return;
    }
    setSecurityEmail(
      window.localStorage.getItem(oneclawStorageKey("email", owner)) ??
        "",
    );
    setOneclawAgentId(
      window.localStorage.getItem(oneclawStorageKey("agent", owner)) ??
        undefined,
    );
  }, [state.session?.walletAddress]);
  useEffect(() => {
    if (!state.session?.walletAddress) {
      setOneclawConnection(undefined);
      return;
    }
    const controller = new AbortController();
    loadOneClawUserConnection()
      .then((connection) => {
        if (controller.signal.aborted) return;
        setOneclawConnection(connection);
        setSecurityStarted(connection.status === "claim_pending");
        if (connection.oneclawAgentId) {
          setOneclawAgentId(connection.oneclawAgentId);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOneclawConnection(undefined);
        }
      });
    return () => controller.abort();
  }, [state.session?.walletAddress, state.phase]);
  useEffect(() => {
    const controller = new AbortController();
    loadOneClawIntegrationHealth(controller.signal)
      .then(setOneclawHealth)
      .catch(() =>
        setOneclawHealth({
          configured: false,
          status: "degraded",
          checkedAt: new Date().toISOString(),
          platformApi: false,
          reason: "unreachable",
        }),
      );
    return () => controller.abort();
  }, []);
  const canActivateSecurity = Boolean(
    oneclawHealth?.status === "ready" &&
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
          <h2>Your Financial Assistant Fleet</h2>
          <p className="fleetCopy">
            {fleetHeadline(state.phase, wallet.connected)}
          </p>
        </div>
        <b className={`fleetCount ${displayState}`}>
          {state.busy || state.fundingBusy
            ? "Waking agents…"
            : displayState === "ready"
            ? "4/4 ready"
            : displayState === "idle" && wallet.connected
              ? "Asleep · wakes on demand"
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

      {!state.busy && !state.fundingBusy && (
        <WorkflowBanner workflow={workflow} />
      )}

      {showFundingAction && state.funding && (
        <section className="fleetFunding" aria-label="Fleet activation">
          <div>
            <span>Private compute activation</span>
            <strong>
              Start this wallet&apos;s fleet with {state.funding.amount}{" "}
              {state.funding.symbol}
            </strong>
            <p>
              This prepaid credit runs your four private agents. Your
              wallet signs an exact x402 authorization on Robinhood Chain;
              Stack settles it, then EQLTY resumes this consultation.
            </p>
            <small>
              Estimated rate: $0.15 per fleet hour. Unused credit remains in
              your PerkOS infrastructure balance.
            </small>
          </div>
          <button
            disabled={state.fundingBusy}
            onClick={() => void state.fundAndRetry()}
            type="button"
          >
            {state.fundingBusy
              ? "Activating with Stack..."
              : `Activate fleet · ${state.funding.amount} USDG`}
          </button>
        </section>
      )}

      {state.fundingReceipt && (
        <div className="fleetFundingReceipt">
          <span>PerkOS compute funded</span>
          <a
            href={`https://robinhoodchain.blockscout.com/tx/${state.fundingReceipt.transaction}`}
            rel="noreferrer"
            target="_blank"
          >
            View x402 transaction ↗
          </a>
        </div>
      )}

      {state.activation?.verified && (
        <FleetPolicyEditor rootName={state.activation.rootName} />
      )}

      <div className="fleetGrid runtimeGrid">
        {agents.map((agent, index) => {
          const workflowState = roleWorkflowState(agent.role, workflow);
          return (
            <div
              className={`agentNode workflow-${workflowState}`}
              key={agent.role}
            >
              <AgentCard
                agent={agent}
                index={index}
                oneclawAgentId={
                  agent.role === "trader" ? oneclawAgentId : undefined
                }
                oneclawActive={
                  agent.role === "trader" && executionLinked
                }
                phase={state.phase}
                rootName={state.activation?.rootName}
                runtimeAvailable={Boolean(runtime)}
                workflow={workflow}
                workflowState={workflowState}
              />
              {index < agents.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`agentConnector ${connectorState(index, workflow)}`}
                >
                  <i />
                  <b>›</b>
                </span>
              )}
            </div>
          );
        })}
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
            <i
              aria-label="1Claw platform status"
              className={`oneclawHealth ${oneclawHealth?.status ?? "checking"}`}
            >
              {oneclawHealthLabel(oneclawHealth)}
            </i>
            <strong>
              {executionLinked
                ? "Trader linked"
                : oneclawConnection?.status === "claim_pending"
                  ? "Claim required"
                  : "Setup required"}
            </strong>
            <p>
              {executionLinked
                ? "The user-owned 1Claw vault is linked. Purchases of 3 USDG or more remain locked until live x401 and x402 authorization is enabled."
                : oneclawConnection?.status === "claim_pending" ||
                    securityStarted
                  ? "Complete the 1Claw authorization, then check the connection."
                  : oneclawHealth?.status === "ready"
                    ? "Continue to create a user-owned vault and Trader agent. Usage belongs to the user's 1Claw account."
                    : oneclawHealthMessage(oneclawHealth)}
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
                );
                if (claimTab) claimTab.opener = null;
                try {
                  const result =
                    await activateOneClawRails(securityEmail);
                  window.localStorage.setItem(
                    oneclawStorageKey(
                      "email",
                      state.session!.walletAddress,
                    ),
                    securityEmail,
                  );
                  if ("executionAgent" in result) {
                    setOneclawAgentId(
                      result.executionAgent.oneclawAgentId,
                    );
                    window.localStorage.setItem(
                      oneclawStorageKey(
                        "agent",
                        state.session!.walletAddress,
                      ),
                      result.executionAgent.oneclawAgentId,
                    );
                  }
                  setOneclawConnection(
                    result.status === "linked"
                      ? {
                          status: "active",
                          connectionId: result.connectionId,
                          oneclawAgentId:
                            result.executionAgent.oneclawAgentId,
                          vaultId: result.vaultId,
                        }
                      : result.status === "claim_required"
                        ? {
                            status: "claim_pending",
                            connectionId: result.connectionId,
                            oneclawAgentId:
                              result.executionAgent.oneclawAgentId,
                            vaultId: result.vaultId,
                          }
                        : { status: "not_connected" },
                  );
                  setSecurityStarted(true);
                  const nextUrl =
                    result.status === "link_required"
                      ? result.authorizeUrl
                      : result.status === "claim_required"
                        ? result.claimUrl
                        : undefined;
                  if (claimTab && nextUrl) {
                    claimTab.location.href = nextUrl;
                  } else if (nextUrl) {
                    window.location.href = nextUrl;
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
                  : securityStarted ||
                      oneclawConnection?.status === "claim_pending"
                    ? "Check connection"
                    : "Continue in 1Claw"}
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
          Keep this tab open while the private fleet wakes for this consultation.
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
          <button
            onClick={goal.workflowError ? goal.analyze : state.retry}
            type="button"
          >
            {goal.workflowError ? "Restart consultation" : "Try again"}
          </button>
        </div>
      )}
    </section>
  );
}

function oneclawHealthLabel(
  health?: OneClawIntegrationHealth,
): string {
  if (!health) return "Checking";
  if (health.status === "ready") return "Platform ready";
  if (health.status === "pending") return "Not configured";
  return "Platform unavailable";
}

function oneclawHealthMessage(
  health?: OneClawIntegrationHealth,
): string {
  if (!health) return "Checking the 1Claw Platform API before setup.";
  if (health.reason === "unauthorized") {
    return "The 1Claw Platform API credential needs attention.";
  }
  if (health.reason === "not-configured") {
    return "The 1Claw Platform API is not configured for this environment.";
  }
  return "The 1Claw Platform API is temporarily unavailable.";
}

type PolicyPreset = "protect" | "opportunity" | "stop";

function FleetPolicyEditor({ rootName }: { rootName: string }) {
  const [busy, setBusy] = useState<PolicyPreset>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [transactions, setTransactions] = useState<Array<`0x${string}`>>(
    [],
  );

  const apply = async (preset: PolicyPreset) => {
    setBusy(preset);
    setStatus(undefined);
    setError(undefined);
    setTransactions([]);
    try {
      const current = await loadFleetPolicy();
      const base = {
        maxAmountPerTrade: current.limits.maxAmountPerTrade,
        maxDeviationBps: current.limits.maxDeviationBps,
        minLiquidityUsd: current.limits.minLiquidityUsd,
        maxOracleAgeSeconds: current.limits.maxOracleAgeSeconds,
      };
      const change =
        preset === "protect"
          ? {
              paused: false,
              allowedTickers: ["NVDA", "AMZN"],
              maxAmountPerTrade: "500000",
              maxDeviationBps: 100,
              minLiquidityUsd: 250_000,
              maxOracleAgeSeconds: 300,
            }
          : preset === "opportunity"
            ? {
                paused: false,
                allowedTickers: [
                  "NVDA",
                  "AMZN",
                  "AMD",
                  "NFLX",
                  "PLTR",
                  "TSLA",
                ],
                maxAmountPerTrade: "1000000",
                maxDeviationBps: 300,
                minLiquidityUsd: 50_000,
                maxOracleAgeSeconds: 86_400,
              }
            : {
                ...base,
                paused: true,
                allowedTickers: current.allowedTickers,
              };
      const published = await publishDemoFleetPolicy(change);
      setTransactions(published.transactions);
      setStatus(
        `ENS policy v${published.manifest.version} verified. The next consultation will use it.`,
      );
      window.dispatchEvent(new Event("eqlty:policy-published"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ENS publication failed",
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="fleetPolicyEditor">
      <div>
        <span>ENS behavior controls</span>
        <strong>{rootName}</strong>
        <small>
          Publish a real policy change and rerun the consultation.
        </small>
      </div>
      <div className="fleetPolicyPresets">
        <button
          disabled={Boolean(busy)}
          onClick={() => void apply("protect")}
          type="button"
        >
          {busy === "protect" ? "Publishing…" : "Capital protection"}
        </button>
        <button
          disabled={Boolean(busy)}
          onClick={() => void apply("opportunity")}
          type="button"
        >
          {busy === "opportunity" ? "Publishing…" : "Opportunity mode"}
        </button>
        <button
          className="stop"
          disabled={Boolean(busy)}
          onClick={() => void apply("stop")}
          type="button"
        >
          {busy === "stop" ? "Stopping…" : "Emergency stop"}
        </button>
      </div>
      {status && <p className="fleetPolicyStatus">{status}</p>}
      {error && <p className="fleetPolicyError">{error}</p>}
      {transactions.length > 0 && (
        <div className="fleetPolicyTransactions">
          {transactions.map((hash, index) => (
            <a
              href={`https://sepolia.basescan.org/tx/${hash}`}
              key={hash}
              rel="noreferrer"
              target="_blank"
            >
              ENS tx {index + 1} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowBanner({ workflow }: { workflow: FleetWorkflow }) {
  if (!workflow.started) {
    return null;
  }
  const cycle = workflow.session?.cyclesCompleted ?? 0;
  const technology = workflowTechnologySteps(workflow);

  return (
    <div
      aria-live="polite"
      className={`fleetWorkflowBanner ${workflow.phase}`}
    >
      <span>
        <i />
        {workflow.phase === "blocked"
          ? "Agent trace incomplete"
          : workflow.processing
            ? "Live agent trace"
            : "Agent trace complete"}
      </span>
      <strong>{workflowHeadline(workflow)}</strong>
      <small>
        {workflow.stopReason ??
          (cycle > 0
            ? `Cycle ${cycle} is sealed with verifiable evidence.`
            : "ENS rules are being checked for every agent.")}
      </small>
      <ol aria-label="Live technology workflow" className="workflowTechRail">
        {technology.map((step, index) => (
          <li className={step.state} key={step.label}>
            <i />
            <span>
              <b>{step.label}</b>
              <small>{step.detail}</small>
            </span>
            {index < technology.length - 1 && (
              <em aria-hidden="true">›</em>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgentCard({
  agent,
  index,
  oneclawAgentId,
  oneclawActive,
  phase,
  rootName,
  runtimeAvailable,
  workflow,
  workflowState,
}: {
  agent: FleetAgent;
  index: number;
  oneclawAgentId?: string;
  oneclawActive: boolean;
  phase: FleetPhase;
  rootName?: string;
  runtimeAvailable: boolean;
  workflow: FleetWorkflow;
  workflowState: WorkflowState;
}) {
  const visualPhase = runtimeAvailable
    ? agentStateToPhase(agent.state)
    : staggerPhase(phase, index);
  const completedSteps = stepProgress(visualPhase);

  return (
    <article
      className={`agentCard ${agent.state} ${
        agent.role === "trader" ? "hasOneclaw" : ""
      } workflow-${workflowState}`}
    >
      <span className="roleMark">
        <i />
      </span>
      {agent.role === "trader" && (
        <a
          aria-label="Open the trader settings in 1Claw"
          className={`oneclawAgentLink ${
            oneclawActive ? "linked" : ""
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
        <b className={workflowState}>
          {workflow.started
            ? workflowStateCopy(workflowState)
            : agentPhaseCopy(visualPhase)}
        </b>
        <small>
          {agent.role !== "trader"
            ? "No spending authority"
            : oneclawActive
              ? "1Claw linked"
              : agent.oneclaw === "linked"
                ? "1Claw claim pending"
                : "1Claw pending"}
        </small>
      </div>
      {workflow.started && (
        <AgentPolicyChecks
          role={agent.role}
          workflow={workflow}
          workflowState={workflowState}
        />
      )}
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

function AgentPolicyChecks({
  role,
  workflow,
  workflowState,
}: {
  role: AgentRole;
  workflow: FleetWorkflow;
  workflowState: WorkflowState;
}) {
  const [metadata, setMetadata] = useState<EnsAgentMetadata>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!workflow.runKey) {
      return;
    }
    let cancelled = false;
    setMetadata(undefined);
    setError(undefined);
    setLoading(true);
    loadFleetMetadata(role)
      .then((next) => {
        if (!cancelled) setMetadata(next);
      })
      .catch(() => {
        if (!cancelled) setError("ENS metadata unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, workflow.runKey]);

  const checks = policyChecks(
    role,
    metadata,
    loading,
    error,
    workflow,
    workflowState,
  );
  const result = policyResultLabel(checks);
  const resultClass =
    result === "Rules pass" ? "passed" : result.toLowerCase();

  return (
    <div
      className={`agentPolicyChecks ${workflowState} result-${resultClass}`}
    >
      <header>
        <span>ENS rule validation</span>
        <b>{result}</b>
      </header>
      <ul>
        {checks.map((check, index) => (
          <li
            className={check.state}
            key={check.label}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <i />
            <span>{check.label}</span>
            <small title={check.value}>{check.value}</small>
          </li>
        ))}
      </ul>
    </div>
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
    idle: "No compute is running. Start a consultation to wake the fleet.",
    locating: "Looking for your existing agents",
    creating: "Creating missing agent identities",
    provisioning: "Provisioning isolated private agents",
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

function oneclawStorageKey(
  field: "agent" | "email",
  owner: `0x${string}`,
): string {
  return `eqlty_oneclaw_${field}_${owner.toLowerCase()}`;
}
