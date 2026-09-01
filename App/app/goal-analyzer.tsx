"use client";

import type {
  AutonomousGoal,
  OpportunityAnalysis,
  OpportunityCandidate,
} from "../lib/goal-types";
import {
  addressUrl,
  transactionEventsUrl,
} from "../lib/execution-api";
import { ensManagerUrl } from "../lib/fleet-api";
import { ProofRunPanel } from "./proof-run-panel";
import type { GoalAnalysisState } from "./use-goal-analysis";
import { DecisionRoom } from "./decision-room";
import { useProofRun } from "./use-proof-run";

const roles = ["Scout", "Risk", "Trader", "Auditor"];
const goalPresets = [
  {
    label: "Conservative income",
    value:
      "Find the lowest risk stock token with high liquidity and consistent pricing.",
  },
  {
    label: "Momentum swing",
    value:
      "Find the strongest near-term momentum candidate under active policy limits.",
  },
  {
    label: "Balanced growth",
    value:
      "Find a candidate balancing risk and return with clean Graph liquidity and fast Uniswap execution.",
  },
];
const amountPresets = ["1", "3", "5", "10"];

export function GoalAnalyzer({ state }: { state: GoalAnalysisState }) {
  const analysis = state.session?.latest;

  return (
    <section className="goalAnalyzer">
      <header className="goalHeading">
        <div>
          <span className="eyebrow">Autonomous goal</span>
          <h2>Ask the fleet for a recommendation</h2>
          <p>
            Define an outcome. Watch four agents consult ENS rules, compare
            candidates and explain one recommendation before any execution.
          </p>
          <small className="goalPricingHint">
            {state.feeConfig
              ? `Exact proof fee: ${formatUsdG(state.feeConfig.completeAmount)} USDG with a recommendation · ${formatUsdG(state.feeConfig.noCandidateAmount)} USDG when all candidates are rejected · 0 without complete proof.`
              : "A decision fee is requested only after all four agents produce a verifiable proof."}
          </small>
        </div>
        <span className="goalWindow">02:00 demo window</span>
      </header>

      <div className="goalWorkspace">
        <div className="goalForm">
          <label className="goalObjective">
            <span>Investment objective</span>
            <textarea
              aria-label="Investment objective"
              maxLength={500}
              onChange={(event) => state.setGoalText(event.target.value)}
              value={state.goalText}
            />
          </label>
          <div
            aria-label="Goal presets"
            className="goalPresetActions"
            role="group"
          >
            {goalPresets.map((preset) => (
              <button
                aria-pressed={state.goalText === preset.value}
                className={`goalPresetButton${
                  state.goalText === preset.value ? " active" : ""
                }`}
                key={preset.label}
                onClick={() => state.setGoalText(preset.value)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="goalControlStack">
            <label className="goalCandidateFocus">
              <span>Candidate focus</span>
              <select
                aria-label="Stock token candidate focus"
                disabled={state.policyLoading || !state.policy}
                onChange={(event) =>
                  state.setCandidateTicker(event.target.value)
                }
                value={state.candidateTicker}
              >
                <option value="">
                  {state.policyLoading
                    ? "Resolving ENS policy..."
                    : state.policy
                      ? `Fleet decides · ${state.policy.allowedTickers.length} ENS allowed`
                      : "Fleet decides from ENS policy"}
                </option>
                {state.policy?.allowedTickers.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    Evaluate {ticker}
                  </option>
                ))}
              </select>
              <small className="goalPolicyHint">
                {state.candidateTicker
                  ? `${state.candidateTicker} must still pass ENS, The Graph and Uniswap gates.`
                  : state.policy
                    ? `The fleet compares up to ${Math.min(10, state.policy.allowedTickers.length)} assets allowed by ENS policy v${state.policy.version}.`
                    : state.policyError
                      ? "The active policy will resolve again when consultation starts."
                      : "Reading the active ENS policy."}
              </small>
            </label>

            <div className="goalInputs">
              <label>
                <span>Fleet budget</span>
                <div className="amountInput">
                  <input
                    aria-label="Goal budget in USDG"
                    inputMode="decimal"
                    onChange={(event) => state.setAmount(event.target.value)}
                    value={state.amount}
                  />
                  <b>USDG</b>
                </div>
                <div className="goalAmountPresets" role="group">
                  {amountPresets.map((preset) => (
                    <button
                      aria-pressed={state.amount === preset}
                      className={`goalAmountPreset${
                        state.amount === preset ? " active" : ""
                      }`}
                      key={preset}
                      onClick={() => state.setAmount(preset)}
                      type="button"
                    >
                      {preset} USDG
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Analysis window</span>
                <select
                  aria-label="Autonomous analysis window"
                  onChange={(event) =>
                    state.setWindowMinutes(Number(event.target.value))
                  }
                  value={state.windowMinutes}
                >
                  <option value={2}>2 minutes</option>
                  <option value={5}>5 minutes</option>
                  <option value={20}>20 minutes</option>
                </select>
              </label>
            </div>

            <button
              className="goalStart"
              disabled={state.busy || state.goalText.trim().length < 10}
              onClick={state.analyze}
              type="button"
            >
              {state.busy
                ? "Consulting the fleet..."
                : state.connected
                  ? `Start ${state.windowMinutes} minute consultation`
                  : "Connect wallet to begin"}
            </button>

            {state.error && <p className="goalError">{state.error}</p>}
          </div>
        </div>

        <aside className="goalBoundaries">
          <span>Boundaries applied every cycle</span>
          <ul>
            <li>
              <i>ENS</i>
              Behavior and allowed assets
            </li>
            <li>
              <i>1C</i>
              Agent spending controls
            </li>
            <li>
              <i>UG</i>
              Executable Uniswap route
            </li>
            <li>
              <i>TG</i>
              Indexed evidence and proof
            </li>
          </ul>
        </aside>
      </div>

      {state.session && (
        <GoalProgress
          analysis={analysis}
          onPay={state.payDecisionFee}
          paymentBusy={state.paymentBusy}
          session={state.session}
        />
      )}
    </section>
  );
}

function GoalProgress({
  analysis,
  onPay,
  paymentBusy,
  session,
}: {
  analysis?: OpportunityAnalysis;
  onPay: () => void;
  paymentBusy: boolean;
  session: AutonomousGoal;
}) {
  const active = session.status === "active";
  const paymentRequired = session.status === "payment-required";
  const proof = useProofRun(session);

  return (
    <div className="goalProgress">
      <header>
        <div>
          <span className={`goalStatus ${session.status}`}>
            <i />
            {active
              ? "Fleet monitoring"
              : paymentRequired
                ? "Proof sealed"
                : session.status}
          </span>
          <strong>
            {session.cyclesCompleted} evaluation
            {session.cyclesCompleted === 1 ? "" : "s"} sealed
          </strong>
        </div>
        <small>
          {active
            ? `${remaining(session.endsAt)} remaining`
            : paymentRequired
              ? "x402 authorization required"
              : "Decision complete"}
        </small>
      </header>

      <div className="goalRolePath" aria-label="Agent analysis path">
        {roles.map((role, index) => (
          <span key={role}>
            <i>{index + 1}</i>
            {role}
          </span>
        ))}
      </div>

      <div className="goalGateRow">
        <span>
          <b>ENS</b>
          {analysis &&
          ["ens", "durin"].includes(analysis.policy.source)
            ? "Resolved from ENS L2"
            : "Local policy fallback"}
        </span>
        <span>
          <b>1Claw</b>
          {oneclawLabel(session)}
        </span>
        <span>
          <b>Proof</b>
          {analysis ? short(analysis.proofRoot) : "Waiting for first cycle"}
        </span>
      </div>
      <div className="goalEvidenceGrid">
        {goalEvidenceCards(analysis).map((entry) => (
          <article
            className={`goalEvidenceCard ${entry.state}`}
            key={entry.title}
          >
            <span>{entry.title}</span>
            <strong>{entry.value}</strong>
            <small>{entry.detail}</small>
            {entry.link && (
              <a href={entry.link} rel="noreferrer" target="_blank">
                {entry.linkLabel}
              </a>
            )}
          </article>
        ))}
      </div>

      {session.error && <p className="goalError">{session.error}</p>}

      {session.decisionFee && (
        <DecisionFeePanel
          busy={paymentBusy}
          fee={session.decisionFee}
          onPay={onPay}
        />
      )}

      {analysis && (
        <div className="candidateResult">
          <DecisionRoom analysis={analysis} />
          <header>
            <div>
              <span>Fleet conclusion</span>
              <strong>
                {analysis.candidates.length} candidates with auditable scores
              </strong>
            </div>
            <code>
              {analysis.policy.version
                ? `Policy v${analysis.policy.version}`
                : `Policy ${analysis.policy.source}`}
            </code>
          </header>
          <div className="candidateGrid">
            {analysis.candidates.map((candidate, index) => (
              <CandidateCard
                candidate={candidate}
                index={index}
                key={candidate.ticker}
              />
            ))}
          </div>
          <footer className="candidateDecision">
            <div>
              <strong>
                {analysis.recommendedTicker
                  ? `${analysis.recommendedTicker} advances to the proof path`
                  : "No candidate passed this cycle"}
              </strong>
              <small>
                The analysis is complete. Execution remains optional and
                requires explicit wallet approval.
              </small>
            </div>
            <span>No funds moved</span>
          </footer>
          <ProofRunPanel
            hasCandidate={analysis.candidates.some(
              (candidate) =>
                candidate.status === "recommended" &&
                Boolean(candidate.tokenAddress),
            )}
            state={proof}
          />
        </div>
      )}
    </div>
  );
}

function goalEvidenceCards(
  analysis?: OpportunityAnalysis,
): Array<{
  title: string;
  detail: string;
  state: "waiting" | "ready" | "blocked";
  value: string;
  link?: string;
  linkLabel?: string;
}> {
  if (!analysis) {
    return [
      {
        title: "ENS policy",
        value: "Waiting",
        detail: "No policy has been resolved yet.",
        state: "waiting",
      },
      {
        title: "The Graph",
        value: "Waiting",
        detail: "No candidate evidence loaded yet.",
        state: "waiting",
      },
      {
        title: "Uniswap",
        value: "Waiting",
        detail: "No live route requested yet.",
        state: "waiting",
      },
      {
        title: "Audit",
        value: "Waiting",
        detail: "No proof root yet.",
        state: "waiting",
      },
    ];
  }

  const policySource = ["ens", "durin"].includes(analysis.policy.source)
    ? "ENS"
    : "Local";
  const policyBlocked = analysis.policy.paused
    ? "Fleet paused"
    : analysis.policy.allowedTickers.length === 0
      ? "No allowed tickers"
      : "";

  const bestMatch =
    analysis.candidates.find((candidate) =>
      candidate.status === "recommended" || candidate.status === "eligible",
    ) ??
    analysis.candidates[0];
  const graphEvidence = bestMatch?.graphEvidence;
  const graphReady = analysis.candidates.filter(
    (candidate) => candidate.orchestrationReady,
  ).length;
  const graphRoute = analysis.candidates.find(
    (candidate) => candidate.uniswapRequestId,
  );

  return [
    {
      title: "ENS policy",
      value: `${policySource} v${analysis.policy.version ?? "local"}`,
      detail:
        policyBlocked ||
        `${analysis.policy.allowedTickers.length} allowed symbols under active rules`,
      state: policyBlocked ? "blocked" : "ready",
      link: analysis.policy.rootName
        ? ensManagerUrl(analysis.policy.rootName)
        : undefined,
      linkLabel: analysis.policy.rootName ? "Open ENS policy ↗" : undefined,
    },
    {
      title: "The Graph",
      value: `${graphReady} verified routes`,
      detail: graphEvidence
        ? `${graphEvidence.blockNumber} checkpoint · ${formatUsd(
            graphEvidence.liquidityUsd,
          )} liquidity`
        : "No candidate passed the Graph evidence check",
      state: graphReady > 0 ? "ready" : "blocked",
      link: graphEvidence?.transactionHash
        ? transactionEventsUrl(graphEvidence.transactionHash)
        : undefined,
      linkLabel: graphEvidence ? "Open Graph event ↗" : undefined,
    },
    {
      title: "Uniswap",
      value:
        graphRoute?.uniswapRequestId
          ? `${graphRoute.ticker} route ${short(graphRoute.uniswapRequestId)}`
          : "No live route",
      detail:
        graphRoute?.uniswapRouting ??
        "Waiting for an executable V4 path and quote signature",
      state: graphRoute?.uniswapRequestId ? "ready" : "waiting",
      link: graphRoute?.graphEvidence?.poolAddress
        ? addressUrl(graphRoute.graphEvidence.poolAddress)
        : undefined,
      linkLabel:
        graphRoute?.graphEvidence?.poolAddress
          ? "Open V4 contract ↗"
          : undefined,
    },
    {
      title: "Audit",
      value: short(analysis.proofRoot),
      detail:
        analysis.candidates.find(
          (candidate) => candidate.status === "recommended",
        )
          ? "Cycle sealed with proof root"
          : "Workflow ended without a winning recommendation",
      state: analysis.proofRoot ? "ready" : "waiting",
    },
  ];
}

function DecisionFeePanel({
  busy,
  fee,
  onPay,
}: {
  busy: boolean;
  fee: NonNullable<AutonomousGoal["decisionFee"]>;
  onPay: () => void;
}) {
  const exact = formatUsdG(fee.amount);
  return (
    <section className={`decisionFee ${fee.status}`}>
      <div>
        <span>
          {fee.status === "payment-required"
            ? "Verified decision ready"
            : fee.status === "settled"
              ? "Decision receipt"
              : fee.status === "preview"
                ? "Pricing preview"
                : "Decision fee waived"}
        </span>
        <strong>
          {exact} {fee.symbol} · x402 {fee.scheme}
        </strong>
        <small>{fee.reason}</small>
      </div>
      {fee.status === "payment-required" && (
        <button disabled={busy} onClick={onPay} type="button">
          {busy ? "Settling with Stack..." : `Authorize ${exact} USDG`}
        </button>
      )}
      {fee.status === "preview" && (
        <b>No USDG charged in preview mode</b>
      )}
      {fee.status === "waived" && <b>0 USDG charged</b>}
      {fee.receipt && (
        <div className="decisionFeeReceipt">
          {fee.receipt.explorerUrl ? (
            <a
              href={fee.receipt.explorerUrl}
              rel="noreferrer"
              target="_blank"
            >
              View payment transaction ↗
            </a>
          ) : (
            <span>Stack confirmed · transaction lookup pending</span>
          )}
          {fee.receipt.transaction && (
            <code>{short(fee.receipt.transaction)}</code>
          )}
          <code>nonce {short(fee.receipt.authorizationNonce)}</code>
          {fee.receipt.requestId && <code>{fee.receipt.requestId}</code>}
        </div>
      )}
      {fee.error && <p>{fee.error}</p>}
    </section>
  );
}

function oneclawLabel(session: AutonomousGoal): string {
  if (!session.gates.oneclawRequired) return "Optional below 3 USDG";
  if (!session.gates.oneclawLinked) return "Locked from 3 USDG";
  return session.gates.executionAuthorized
    ? "Live rail authorized"
    : "Linked · live spend locked";
}

function CandidateCard({
  candidate,
  index,
}: {
  candidate: OpportunityCandidate;
  index: number;
}) {
  return (
    <article className={`candidateCard ${candidate.status}`}>
      <header>
        <i>{index + 1}</i>
        <div>
          <strong>{candidate.ticker}</strong>
          <small>{candidate.name}</small>
        </div>
        <b>
          {candidate.status === "recommended"
            ? "Selected"
            : candidate.status}
        </b>
      </header>
      <p>{candidate.reason}</p>
      <div className="candidateScore">
        <i style={{ width: `${Math.min(100, Math.max(0, candidate.score))}%` }} />
      </div>
      <footer>
        <span>{formatPrice(candidate.referencePrice)}</span>
        <span>
          {candidate.deviationBps === undefined
            ? "Proof pending"
            : `${candidate.deviationBps.toFixed(0)} bps`}
        </span>
      </footer>
    </article>
  );
}

function remaining(endsAt: string): string {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1_000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function short(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatPrice(value?: string): string {
  if (!value) return "No reference";
  const number = Number(value);
  return Number.isFinite(number)
    ? `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : value;
}

function formatUsd(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "USD",
  })}`;
}

function formatUsdG(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
