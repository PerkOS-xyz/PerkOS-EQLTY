"use client";

import type {
  AutonomousGoal,
  DecisionOutcome,
  FinancialGoalProfile,
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
    label: "Learn first",
    value:
      "Help me understand policy-compatible Stock Tokens without preparing a purchase.",
    profile: {
      purpose: "learn",
      horizonMonths: 24,
      liquidityNeed: "may-need",
      riskComfort: "low",
    } satisfies FinancialGoalProfile,
  },
  {
    label: "Long-term growth",
    value:
      "Compare policy-compatible Stock Tokens for a long-term growth goal.",
    profile: {
      purpose: "long-term-growth",
      horizonMonths: 60,
      liquidityNeed: "can-commit",
      riskComfort: "medium",
    } satisfies FinancialGoalProfile,
  },
  {
    label: "Planned purchase",
    value:
      "Check whether a limited Stock Token position fits a planned future purchase.",
    profile: {
      purpose: "planned-purchase",
      horizonMonths: 12,
      liquidityNeed: "may-need",
      riskComfort: "low",
    } satisfies FinancialGoalProfile,
  },
];
const amountPresets = ["1", "3", "5", "10"];

export function GoalAnalyzer({ state }: { state: GoalAnalysisState }) {
  const analysis = state.session?.latest;

  return (
    <section className="goalAnalyzer">
      <header className="goalHeading">
        <div>
          <span className="eyebrow">Ask your financial assistant fleet</span>
          <h2>What would you like the agents to evaluate?</h2>
          <p>
            Ask in plain language. The fleet checks readiness, compares
            choices and can recommend a candidate, a limited position or
            waiting. Nothing executes during the conversation.
          </p>
          <small className="goalPricingHint">
            {state.feeConfig
              ? `Preview the process first. A ${formatUsdG(state.feeConfig.completeAmount)} USDG fee is requested only when a four-agent decision receipt is ready to seal.`
              : "Preview the process first. A fee is requested only after all four agents produce a verifiable decision receipt."}
          </small>
        </div>
        <span className="goalWindow">02:00 demo window</span>
      </header>

      <div className="goalWorkspace">
        <div className="goalForm">
          <div className="goalNarrative">
            <label className="goalObjective goalConversation">
              <span>Conversation</span>
              <div className="goalConversationComposer">
                <i aria-hidden="true">You</i>
                <div>
                  <b>Ask the fleet</b>
                  <textarea
                    aria-label="Investment objective"
                    maxLength={500}
                    onChange={(event) =>
                      state.setGoalText(event.target.value)
                    }
                    placeholder="For example: Compare a limited Stock Token position for long-term growth."
                    value={state.goalText}
                  />
                </div>
              </div>
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
                onClick={() => {
                  state.setGoalText(preset.value);
                  state.setProfile(preset.profile);
                }}
                type="button"
              >
                {preset.label}
                </button>
              ))}
            </div>

            <div className="goalProfileGrid">
            <label>
              <span>Purpose</span>
              <select
                aria-label="Financial goal purpose"
                onChange={(event) =>
                  state.setProfile({
                    ...state.profile,
                    purpose: event.target.value as FinancialGoalProfile["purpose"],
                  })
                }
                value={state.profile.purpose}
              >
                <option value="learn">Learn first</option>
                <option value="long-term-growth">Long-term growth</option>
                <option value="planned-purchase">Planned purchase</option>
              </select>
            </label>
            <label>
              <span>Time horizon</span>
              <select
                aria-label="Financial goal time horizon"
                onChange={(event) =>
                  state.setProfile({
                    ...state.profile,
                    horizonMonths: Number(event.target.value),
                  })
                }
                value={state.profile.horizonMonths}
              >
                <option value={6}>6 months</option>
                <option value={12}>1 year</option>
                <option value={24}>2 years</option>
                <option value={36}>3 years</option>
                <option value={60}>5 years</option>
              </select>
            </label>
            <label>
              <span>Liquidity need</span>
              <select
                aria-label="Financial goal liquidity need"
                onChange={(event) =>
                  state.setProfile({
                    ...state.profile,
                    liquidityNeed: event.target.value as FinancialGoalProfile["liquidityNeed"],
                  })
                }
                value={state.profile.liquidityNeed}
              >
                <option value="may-need">I may need these funds</option>
                <option value="can-commit">I can leave them invested</option>
              </select>
            </label>
            <label>
              <span>Risk comfort</span>
              <select
                aria-label="Financial goal risk comfort"
                onChange={(event) =>
                  state.setProfile({
                    ...state.profile,
                    riskComfort: event.target.value as FinancialGoalProfile["riskComfort"],
                  })
                }
                value={state.profile.riskComfort}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            </div>
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
                <span>Amount to evaluate</span>
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
                <span>Consultation window</span>
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
                ? "The fleet is discussing your question..."
                : state.connected
                  ? "Ask the four agents"
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
        <RevenueStrip config={state.feeConfig} />
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
          <FleetAnswer analysis={analysis} />
          <DecisionSummary analysis={analysis} />
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
                  : analysis.decisionStatus === "rules_only"
                    ? "Evidence passed, but agent reasoning was not verified"
                    : "No candidate passed this cycle"}
              </strong>
              <small>
                {analysis.recommendedTicker
                  ? "Execution remains optional and requires explicit wallet approval."
                  : "No execution path is available from this consultation."}
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

function FleetAnswer({ analysis }: { analysis: OpportunityAnalysis }) {
  const primary = analysis.outcomes.find(
    (outcome) => outcome.kind === "primary",
  );
  const graphBlock = analysis.candidates.find(
    (candidate) => candidate.graphEvidence,
  )?.graphEvidence?.blockNumber;
  const uniswapRequest = analysis.candidates.find(
    (candidate) => candidate.uniswapRequestId,
  )?.uniswapRequestId;
  const verifiedAgents = Object.values(analysis.receipt.agents).filter(
    (agent) => agent.status === "verified",
  ).length;

  return (
    <section className="fleetAnswer" aria-label="Fleet answer">
      <i aria-hidden="true">EQ</i>
      <div>
        <span>Fleet answer</span>
        <strong>{primary?.title ?? "The fleet recommends waiting"}</strong>
        <p>
          {primary?.summary ??
            "No candidate passed every active evidence and policy gate in this cycle."}
        </p>
        <div className="fleetAnswerProofs">
          <b>{verifiedAgents}/4 agents verified</b>
          <b>ENS policy v{analysis.policy.version ?? "local"}</b>
          <b>{graphBlock ? `Graph block ${graphBlock}` : "Graph gate closed"}</b>
          <b>
            {uniswapRequest
              ? `Uniswap ${short(uniswapRequest)}`
              : "No executable route"}
          </b>
        </div>
        <small>
          Decision support, not a prediction. Review the alternatives and
          evidence below before approving any transaction.
        </small>
      </div>
    </section>
  );
}

function RevenueStrip({
  config,
}: {
  config?: GoalAnalysisState["feeConfig"];
}) {
  return (
    <section className="revenueStrip" aria-label="EQLTY revenue model">
      <header>
        <span>Usage-based business model</span>
        <strong>Users pay for verified decisions, not promises.</strong>
      </header>
      <div>
        <article>
          <b>Free</b>
          <span>Ask, set a goal and preview the process</span>
        </article>
        <article>
          <b>
            {config ? `${formatUsdG(config.completeAmount)} USDG` : "Exact fee"}
          </b>
          <span>Complete four-agent Decision Receipt</span>
        </article>
        <article>
          <b>
            {config
              ? `${formatUsdG(config.noCandidateAmount)} USDG`
              : "Reduced fee"}
          </b>
          <span>Verified no-action decision</span>
        </article>
        <article>
          <b>x402</b>
          <span>Exact wallet payment after proof is ready</span>
        </article>
      </div>
    </section>
  );
}

function DecisionSummary({
  analysis,
}: {
  analysis: OpportunityAnalysis;
}) {
  return (
    <section className="decisionSummary">
      <header>
        <div>
          <span>Goal readiness</span>
          <strong>{analysis.readiness.summary}</strong>
        </div>
        <b className={`decisionTrust ${analysis.decisionStatus}`}>
          {decisionStatusLabel(analysis.decisionStatus)}
        </b>
      </header>
      {analysis.readiness.reasons.length > 0 && (
        <ul>
          {analysis.readiness.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="decisionOutcomes">
        {analysis.outcomes.map((outcome) => (
          <OutcomeCard
            key={`${outcome.kind}-${outcome.ticker ?? outcome.title}`}
            outcome={outcome}
          />
        ))}
      </div>
      <footer className="decisionReceiptSeal">
        <span>Decision receipt</span>
        <code>{analysis.receipt.id}</code>
        <code>{short(analysis.receipt.root)}</code>
        <small>
          {Object.values(analysis.receipt.agents).filter(
            (agent) => agent.responseHash,
          ).length}
          /4 agent outputs hash-bound
        </small>
      </footer>
    </section>
  );
}

function OutcomeCard({ outcome }: { outcome: DecisionOutcome }) {
  return (
    <article className={`decisionOutcome ${outcome.kind}`}>
      <span>
        {outcome.kind === "primary"
          ? "Fleet recommendation"
          : outcome.kind === "alternative"
            ? "Alternative"
            : "No action"}
      </span>
      <strong>{outcome.title}</strong>
      <p>{outcome.summary}</p>
      {outcome.reasons.length > 0 && (
        <ul>
          {outcome.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function decisionStatusLabel(
  status: OpportunityAnalysis["decisionStatus"],
): string {
  if (status === "agent_verified") return "Four-agent verified";
  if (status === "rules_only") return "Rules-only shortlist";
  return "Insufficient evidence";
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
      title: "Decision receipt",
      value: short(analysis.receipt.root),
      detail:
        analysis.candidates.find(
          (candidate) => candidate.status === "recommended",
        )
          ? "Hermes outputs, policy and evidence sealed together"
          : "Workflow ended without a winning recommendation",
      state: analysis.receipt.root ? "ready" : "waiting",
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
        <code className="decisionFeeBinding">
          {fee.decisionReceiptRoot
            ? `receipt ${short(fee.decisionReceiptRoot)}`
            : "Legacy decision · start a new consultation"}
        </code>
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
