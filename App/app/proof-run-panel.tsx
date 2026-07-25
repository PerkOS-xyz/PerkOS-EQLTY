"use client";

import {
  addressUrl,
  blockUrl,
  graphEvidenceUrl,
  transactionEventsUrl,
  transactionUrl,
} from "../lib/execution-api";
import type { TradeRun } from "../lib/execution-types";
import type { ProofRunState } from "./use-proof-run";

export function ProofRunPanel({
  hasCandidate,
  state,
}: {
  hasCandidate: boolean;
  state: ProofRunState;
}) {
  if (!state.run) {
    return (
      <div className="proofStart">
        <div>
          <strong>Send the winner through all four agents</strong>
          <small>
            Get a fresh quote and sealed proof bundle without moving funds.
          </small>
        </div>
        <button
          disabled={!hasCandidate || state.proofBusy}
          onClick={state.runProof}
          type="button"
        >
          {state.proofBusy ? "Running proof..." : "Run four agent proof"}
        </button>
        {state.error && <p>{state.error}</p>}
      </div>
    );
  }

  const run = state.run;
  return (
    <section className={`proofRun ${run.status}`}>
      <header>
        <div>
          <span>{runLabel(run)}</span>
          <strong>{runHeadline(run)}</strong>
          <small>{runSummary(run)}</small>
        </div>
        <b>{run.status}</b>
      </header>

      <div className="proofTimeline">
        {run.steps.map((step, index) => (
          <article className={step.status} key={`${step.id}-${index}`}>
            <i>{step.status === "passed" ? "✓" : index + 1}</i>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
            <b>{step.mode}</b>
          </article>
        ))}
      </div>

      {run.quote && (
        <>
          <div className="proofMetrics">
            <span>
              <b>Uniswap route</b>
              {run.quote.routing}
            </span>
            <span>
              <b>Estimated output</b>
              {formatUnits(run.quote.quotedAmountOut, 18)} {run.ticker}
            </span>
            <span>
              <b>Graph block</b>
              {run.market?.blockNumber ?? "Pending"}
            </span>
            <span>
              <b>Proof bundle</b>
              {run.proofBundleRoot ? short(run.proofBundleRoot) : "Sealing"}
            </span>
          </div>
          {run.market && <VerificationLogs run={run} />}
        </>
      )}

      {run.status === "approved" && (
        <LiveAuthorization
          executionAuthorized={run.oneclaw.executionAuthorized}
          oneclawRequired={run.oneclaw.required}
          state={state}
        />
      )}

      {run.status === "executed" && run.transactionHash && (
        <div className="executionLog">
          <div>
            <span>Uniswap execution log</span>
            <strong>{run.ticker} purchase confirmed</strong>
            <small>
              Request {run.quote?.requestId ?? "sealed in proof bundle"}
            </small>
          </div>
          <a
            href={transactionUrl(run.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            <code>{short(run.transactionHash)}</code>
            <b>Open transaction ↗</b>
          </a>
        </div>
      )}

      {(run.status === "rejected" || run.status === "failed") && (
        <div className="proofRejected">
          <strong>No funds moved</strong>
          <span>{run.rejectionReason ?? "The proof path did not pass."}</span>
        </div>
      )}

      {state.error && <p className="proofError">{state.error}</p>}
    </section>
  );
}

function VerificationLogs({ run }: { run: TradeRun }) {
  const market = run.market!;
  return (
    <section
      aria-label="Verifiable transaction and event logs"
      className="verificationLogs"
    >
      <header>
        <div>
          <span>Verification logs</span>
          <strong>Real transactions and indexed events</strong>
        </div>
        <b>Robinhood Chain</b>
      </header>

      <div className="verificationLogGrid">
        {market.transactionHash && (
          <a
            href={transactionEventsUrl(market.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            <span>Indexed event</span>
            <strong>Uniswap V4 Swap</strong>
            <code>{short(market.eventTopic)}</code>
            <b>Verify event ↗</b>
          </a>
        )}
        <a
          href={blockUrl(market.blockNumber)}
          rel="noreferrer"
          target="_blank"
        >
          <span>Onchain block</span>
          <strong>Graph checkpoint {market.blockNumber}</strong>
          <code>{new Date(market.capturedAt).toLocaleString()}</code>
          <b>Open block ↗</b>
        </a>
        <a
          href={addressUrl(market.poolAddress)}
          rel="noreferrer"
          target="_blank"
        >
          <span>Verified contract</span>
          <strong>Uniswap V4 PoolManager</strong>
          <code>{short(market.poolIdentifier)}</code>
          <b>Open contract ↗</b>
        </a>
        <a
          href={graphEvidenceUrl(run.ticker)}
          rel="noreferrer"
          target="_blank"
        >
          <span>Substreams payload</span>
          <strong>The Graph evidence</strong>
          <code>{run.ticker} · block {market.blockNumber}</code>
          <b>Open JSON ↗</b>
        </a>
        {run.transactionHash && (
          <a
            href={transactionUrl(run.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            <span>Executed transaction</span>
            <strong>{run.ticker} purchase</strong>
            <code>{short(run.transactionHash)}</code>
            <b>Verify purchase ↗</b>
          </a>
        )}
      </div>

      <p>
        Explorer links are onchain evidence. Quote and proof identifiers remain
        labeled as API artifacts until a purchase transaction exists.
      </p>
    </section>
  );
}

function LiveAuthorization({
  executionAuthorized,
  oneclawRequired,
  state,
}: {
  executionAuthorized: boolean;
  oneclawRequired: boolean;
  state: ProofRunState;
}) {
  return (
    <div className="liveAuthorization">
      <div>
        <span>Final authorization</span>
        <strong>
          {executionAuthorized
            ? oneclawRequired
              ? "Proof passed. 1Claw rails are linked."
              : "Proof passed. This purchase is below the 1Claw lock."
            : "Proof passed. 1Claw still blocks this purchase."}
        </strong>
        <small>
          Purchases from 3 USDG require 1Claw. Mainnet also requires live
          identity, x401 and x402 evidence.
        </small>
      </div>
      <label>
        <input
          checked={state.acknowledged}
          disabled={!executionAuthorized}
          onChange={(event) => state.setAcknowledged(event.target.checked)}
          type="checkbox"
        />
        <span>I authorize this exact USDG purchase</span>
      </label>
      <button
        disabled={
          !executionAuthorized ||
          !state.acknowledged ||
          state.purchaseBusy
        }
        onClick={state.executePurchase}
        type="button"
      >
        {state.purchaseBusy ? "Submitting to Uniswap..." : "Execute purchase"}
      </button>
    </div>
  );
}

function runLabel(run: TradeRun): string {
  if (run.status === "executed") return "Uniswap execution confirmed";
  if (run.status === "approved") return "Recommendation ready";
  if (run.status === "rejected") return "Request blocked";
  return "Fleet proof";
}

function runHeadline(run: TradeRun): string {
  if (run.status === "approved" || run.status === "executed") {
    return `${run.signal?.side.toUpperCase() ?? "Review"} ${run.ticker}`;
  }
  return run.rejectionReason ?? "Four agent verification";
}

function runSummary(run: TradeRun): string {
  if (run.status === "executed") {
    return `${formatUnits(run.amountIn, 6)} USDG submitted on Robinhood Chain.`;
  }
  if (run.status === "approved") {
    return "The quote and policy passed. No funds have moved.";
  }
  if (run.status === "rejected") {
    return "The fleet stopped before purchase.";
  }
  return "The fleet is assembling the verification trail.";
}

function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatUnits(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) return value;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, 6);
  return fraction ? `${whole}.${fraction}` : whole;
}
