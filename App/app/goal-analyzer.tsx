"use client";

import type {
  AutonomousGoal,
  OpportunityAnalysis,
  OpportunityCandidate,
} from "../lib/goal-types";
import { ProofRunPanel } from "./proof-run-panel";
import { useGoalAnalysis } from "./use-goal-analysis";
import { useProofRun } from "./use-proof-run";

const roles = ["Scout", "Risk", "Trader", "Auditor"];

export function GoalAnalyzer() {
  const state = useGoalAnalysis();
  const analysis = state.session?.latest;

  return (
    <section className="goalAnalyzer">
      <header className="goalHeading">
        <div>
          <span className="eyebrow">Autonomous goal</span>
          <h2>Give the fleet two minutes</h2>
          <p>
            Define an outcome. Four agents repeatedly compare eligible stock
            tokens without receiving unrestricted control of your funds.
          </p>
        </div>
        <span className="goalWindow">02:00 demo window</span>
      </header>

      <div className="goalWorkspace">
        <div className="goalForm">
          <label>
            <span>Investment objective</span>
            <textarea
              aria-label="Investment objective"
              maxLength={500}
              onChange={(event) => state.setGoalText(event.target.value)}
              value={state.goalText}
            />
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
              ? "Starting the fleet..."
              : state.connected
                ? `Compare for ${state.windowMinutes} minutes`
                : "Connect wallet to begin"}
          </button>

          {state.error && <p className="goalError">{state.error}</p>}
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
          session={state.session}
        />
      )}
    </section>
  );
}

function GoalProgress({
  analysis,
  session,
}: {
  analysis?: OpportunityAnalysis;
  session: AutonomousGoal;
}) {
  const active = session.status === "active";
  const proof = useProofRun(session);

  return (
    <div className="goalProgress">
      <header>
        <div>
          <span className={`goalStatus ${session.status}`}>
            <i />
            {active ? "Fleet monitoring" : session.status}
          </span>
          <strong>
            {session.cyclesCompleted} evaluation
            {session.cyclesCompleted === 1 ? "" : "s"} sealed
          </strong>
        </div>
        <small>
          {active ? `${remaining(session.endsAt)} remaining` : "Window complete"}
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

      {session.error && <p className="goalError">{session.error}</p>}

      {analysis && (
        <div className="candidateResult">
          <header>
            <div>
              <span>Latest shortlist</span>
              <strong>{analysis.candidates.length} candidates compared</strong>
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
                A purchase still requires policy, evidence and quote approval.
              </small>
            </div>
            <span>Proof required</span>
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

function oneclawLabel(session: AutonomousGoal): string {
  if (!session.gates.oneclawRequired) return "Optional below 3 USDG";
  return session.gates.oneclawLinked
    ? "Rails linked"
    : "Locked from 3 USDG";
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
