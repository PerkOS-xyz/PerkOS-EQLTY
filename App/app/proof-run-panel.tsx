"use client";

import Link from "next/link";
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
          <strong>Recheck the recommendation for execution</strong>
          <small>
            Resolve ENS again, refresh Graph evidence and seal a fresh
            Uniswap quote without moving funds.
          </small>
        </div>
        <button
          disabled={!hasCandidate || state.proofBusy}
          onClick={state.runProof}
          type="button"
        >
          {state.proofBusy ? "Running proof..." : "Run execution proof"}
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
        <PurchaseReviewEntry state={state} />
      )}

      {state.strategy?.onchain && (
        <WalletStrategyLogs strategy={state.strategy} />
      )}

      {state.reviewOpen && (
        <PurchaseReviewScreen run={run} state={state} />
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
          {run.audit?.status === "stored" && (
            <Link href={`/history/${run.transactionHash}`}>
              <code>{short(run.audit.bundleHash ?? run.transactionHash)}</code>
              <b>Open full audit →</b>
            </Link>
          )}
        </div>
      )}

      {run.audit?.status === "failed" && (
        <div className="proofRejected">
          <strong>Audit storage needs attention</strong>
          <span>{run.audit.error ?? "The onchain purchase still succeeded."}</span>
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

function PurchaseReviewEntry({
  state,
}: {
  state: ProofRunState;
}) {
  return (
    <div className="liveAuthorization">
      <div>
        <span>Purchase review required</span>
        <strong>Review the exact wallet actions before signing.</strong>
        <small>
          See balances, limits, expected output and every transaction in one
          screen.
        </small>
      </div>
      <button
        disabled={state.purchaseBusy}
        onClick={state.openReview}
        type="button"
      >
        Review purchase
      </button>
    </div>
  );
}

function PurchaseReviewScreen({
  run,
  state,
}: {
  run: TradeRun;
  state: ProofRunState;
}) {
  const readiness = state.readiness;
  const funded = Boolean(state.strategy?.onchain);
  const fundsAfter =
    funded
      ? readiness?.usdGBalance ?? "0"
      : readiness &&
    BigInt(readiness.usdGBalance) >= BigInt(readiness.amountIn)
      ? (BigInt(readiness.usdGBalance) - BigInt(readiness.amountIn)).toString()
      : "0";
  return (
    <div className="purchaseReviewBackdrop">
      <section
        aria-label={`Review ${run.ticker} purchase`}
        aria-modal="true"
        className="purchaseReview"
        role="dialog"
      >
        <header>
          <div>
            <span>Final authorization</span>
            <strong>Review {run.ticker} purchase</strong>
            <small>Robinhood Chain · Uniswap · wallet owned strategy</small>
          </div>
          <button
            aria-label="Close purchase review"
            disabled={state.purchaseBusy}
            onClick={state.closeReview}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="purchaseReviewSummary">
          <span>
            <small>You pay</small>
            <strong>{formatUnits(run.amountIn, 6)} USDG</strong>
          </span>
          <i>→</i>
          <span>
            <small>Estimated receive</small>
            <strong>
              {formatUnits(run.quote?.quotedAmountOut ?? "0", 18)} {run.ticker}
            </strong>
          </span>
        </div>

        <div className="purchaseReviewGrid">
          <article>
            <span>Wallet and balances</span>
            {state.reviewBusy ? (
              <strong>Checking Robinhood Chain...</strong>
            ) : readiness ? (
              <>
                <code>{readiness.wallet}</code>
                <dl>
                  <div>
                    <dt>USDG balance</dt>
                    <dd>{formatUnits(readiness.usdGBalance, 6)} USDG</dd>
                  </div>
                  <div>
                    <dt>{funded ? "Wallet remains" : "After funding"}</dt>
                    <dd>{formatUnits(fundsAfter, 6)} USDG</dd>
                  </div>
                  <div>
                    <dt>Gas balance</dt>
                    <dd>{formatUnits(readiness.nativeBalance, 18)} ETH</dd>
                  </div>
                </dl>
              </>
            ) : (
              <strong>Wallet check unavailable</strong>
            )}
          </article>

          <article>
            <span>Protection limits</span>
            <dl>
              <div>
                <dt>Max spend</dt>
                <dd>{formatUnits(run.amountIn, 6)} USDG</dd>
              </div>
              <div>
                <dt>Max slippage</dt>
                <dd>
                  {((state.strategy?.maxSlippageBps ?? 0) / 100).toFixed(2)}%
                </dd>
              </div>
              <div>
                <dt>1Claw</dt>
                <dd>{run.oneclaw.required ? "Required" : "Below lock"}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div className="purchaseReviewChecks">
          <strong>Preflight checks</strong>
          <span className={readiness?.checks.funds ? "passed" : ""}>
            <i>{readiness?.checks.funds ? "✓" : "·"}</i>
            {funded ? "Strategy already funded" : "Enough USDG"}
          </span>
          <span className={readiness?.checks.gas ? "passed" : ""}>
            <i>{readiness?.checks.gas ? "✓" : "·"}</i>
            {funded ? "Owner signatures complete" : "Gas available"}
          </span>
          <span className={readiness?.checks.vault ? "passed" : ""}>
            <i>{readiness?.checks.vault ? "✓" : "·"}</i>
            Vault verified
          </span>
        </div>

        <div className="purchaseReviewSteps">
          <strong>
            {funded ? "Recovered wallet authorization" : "What your wallet will sign"}
          </strong>
          {(funded
            ? [
                [
                  "✓",
                  `Strategy #${state.strategy?.onchain?.strategyId}`,
                  "Existing owner-funded strategy recovered from Robinhood Chain",
                ],
                [
                  "1",
                  "Agent execution",
                  "Hermes submits the guarded Uniswap swap",
                ],
              ]
            : [
            [
              "1",
              "Create strategy",
              `Bind ${run.ticker}, limits and Hermes trader`,
            ],
            [
              "2",
              `Approve ${formatUnits(run.amountIn, 6)} USDG`,
              "Exact allowance to the EQLTY vault",
            ],
            [
              "3",
              "Fund strategy",
              `Move ${formatUnits(run.amountIn, 6)} USDG into your strategy`,
            ],
            ["4", "Agent execution", "Hermes submits the guarded Uniswap swap"],
          ]).map(([number, title, detail]) => (
            <span key={number}>
              <i>{number}</i>
              <b>{title}</b>
              <small>{detail}</small>
            </span>
          ))}
        </div>

        <footer>
          <label>
            <input
              checked={state.acknowledged}
              disabled={!readiness?.ready || state.purchaseBusy}
              onChange={(event) =>
                state.setAcknowledged(event.target.checked)
              }
              type="checkbox"
            />
            <span>
              I authorize this exact {formatUnits(run.amountIn, 6)} USDG{" "}
              {run.ticker} purchase
            </span>
          </label>
          {readiness && !readiness.ready && (
            <p>Resolve the failed preflight check before authorizing.</p>
          )}
          {state.error && <p>{state.error}</p>}
          <div>
            <button
              disabled={state.purchaseBusy}
              onClick={state.closeReview}
              type="button"
            >
              Back
            </button>
            <button
              disabled={
                !readiness?.ready ||
                !state.acknowledged ||
                state.purchaseBusy
              }
              onClick={state.executePurchase}
              type="button"
            >
              {state.purchaseBusy
                ? purchaseLabel(state.purchaseStage)
                : funded
                  ? "Execute funded strategy"
                  : "Authorize with wallet"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function WalletStrategyLogs({
  strategy,
}: {
  strategy: NonNullable<ProofRunState["strategy"]>;
}) {
  const onchain = strategy.onchain!;
  const entries = [
    ["Strategy created", onchain.creationTransactionHash],
    ["USDG approved", onchain.approvalTransactionHash],
    ["Strategy funded", onchain.fundingTransactionHash],
  ] as const;
  return (
    <section className="walletStrategyLogs">
      <header>
        <div>
          <span>Wallet authorization</span>
          <strong>Strategy #{onchain.strategyId} belongs to your wallet</strong>
        </div>
        <b>3 confirmed transactions</b>
      </header>
      <div>
        {entries.map(([label, hash]) => (
          <a
            href={transactionUrl(hash)}
            key={label}
            rel="noreferrer"
            target="_blank"
          >
            <span>{label}</span>
            <code>{short(hash)}</code>
            <b>Verify ↗</b>
          </a>
        ))}
      </div>
    </section>
  );
}

function purchaseLabel(stage: ProofRunState["purchaseStage"]): string {
  const labels = {
    idle: "Preparing wallet...",
    checking: "Checking wallet...",
    creating: "Create strategy in wallet...",
    approving: "Approve USDG in wallet...",
    funding: "Fund strategy in wallet...",
    linking: "Linking strategy...",
    executing: "Submitting to Uniswap...",
  };
  return labels[stage];
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
