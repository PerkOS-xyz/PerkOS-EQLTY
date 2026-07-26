"use client";

import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { PortfolioHolding } from "../../lib/audit-types";
import {
  blockUrl,
  transactionEventsUrl,
  transactionUrl,
} from "../../lib/execution-api";
import {
  recordSaleAudit,
  requestSellQuote,
  type WalletSellQuote,
} from "../../lib/sell-api";
import type { SaleAuditBundle } from "../../lib/audit-types";
import {
  executeWalletSell,
  type SellStage,
  type WalletSellResult,
} from "../../lib/wallet-sell";
import { GraphEvidenceModal } from "../graph-evidence-modal";
import { useWalletAccess } from "../wallet-access-context";

const percentages = [25, 50, 100] as const;
type JourneyStage =
  | "idle"
  | "quoting"
  | "quoted"
  | SellStage
  | "complete"
  | "evidence-error";
type JourneyStatus = "pending" | "active" | "complete" | "skipped" | "error";

export function SellPosition({
  holding,
  onComplete,
}: {
  holding: PortfolioHolding;
  onComplete: () => void;
}) {
  const wallet = useWalletAccess();
  const [open, setOpen] = useState(false);
  const [percentage, setPercentage] = useState(100);
  const [quote, setQuote] = useState<WalletSellQuote>();
  const [result, setResult] = useState<WalletSellResult>();
  const [audit, setAudit] = useState<SaleAuditBundle>();
  const [stage, setStage] = useState<SellStage>("idle");
  const [journeyStage, setJourneyStage] =
    useState<JourneyStage>("idle");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [permitRequired, setPermitRequired] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string>();
  const rawBalance = useMemo(
    () => parseUnits(holding.balance, holding.decimals),
    [holding.balance, holding.decimals],
  );
  const amountIn = useMemo(
    () => ((rawBalance * BigInt(percentage)) / 100n).toString(),
    [percentage, rawBalance],
  );
  const tokenAmount = formatUnits(BigInt(amountIn), holding.decimals);
  const busy = quoting || stage !== "idle";

  function choosePercentage(next: number) {
    if (busy) return;
    setPercentage(next);
    setQuote(undefined);
    setAudit(undefined);
    setError(undefined);
    setJourneyStage("idle");
  }

  async function getQuote() {
    setQuoting(true);
    setJourneyStage("quoting");
    setError(undefined);
    setResult(undefined);
    setAudit(undefined);
    try {
      const nextQuote = await requestSellQuote({
        ticker: holding.ticker,
        tokenIn: holding.tokenAddress,
        amountIn,
      });
      setQuote(nextQuote);
      setApprovalRequired(Boolean(nextQuote.approval));
      setPermitRequired(Boolean(nextQuote.permitData));
      setJourneyStage("quoted");
    } catch (caught) {
      setError(message(caught));
      setJourneyStage("idle");
    } finally {
      setQuoting(false);
    }
  }

  async function confirmSale() {
    if (!quote) return;
    setError(undefined);
    try {
      const completed = await executeWalletSell({
        wallet,
        quote,
        onStage: (nextStage) => {
          setStage(nextStage);
          setJourneyStage(nextStage);
          if (nextStage === "approving") setApprovalRequired(true);
          if (nextStage === "signing") setPermitRequired(true);
        },
      });
      setResult(completed);
      setQuote(undefined);
      onComplete();
      setStage("recording");
      setJourneyStage("recording");
      try {
        const nextAudit = await recordSaleAudit({
          ticker: completed.ticker,
          tokenIn: completed.tokenIn,
          tokenInDecimals: holding.decimals,
          amountIn: completed.amountIn,
          quotedAmountOut: completed.amountOut,
          requestId: completed.requestId,
          routing: completed.routing,
          transactionHash: completed.transactionHash,
          approvalTransactionHash:
            completed.approvalTransactionHash,
        });
        setAudit(nextAudit);
        setJourneyStage("complete");
      } catch (caught) {
        setJourneyStage("evidence-error");
        setError(
          `Sale confirmed, but evidence storage needs retry: ${message(caught)}`,
        );
      }
    } catch (caught) {
      setError(message(caught));
      setJourneyStage("quoted");
    } finally {
      setStage("idle");
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setQuote(undefined);
    setResult(undefined);
    setAudit(undefined);
    setError(undefined);
    setPercentage(100);
    setJourneyStage("idle");
    setApprovalRequired(false);
    setPermitRequired(false);
  }

  return (
    <>
      <button
        className="sellPositionButton"
        onClick={() => setOpen(true)}
        type="button"
      >
        Sell for USDG
      </button>
      {open && (
        <div className="sellBackdrop" role="presentation">
          <section
            aria-label={`Sell ${holding.ticker}`}
            aria-modal="true"
            className="sellDialog"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">Wallet confirmed exit</span>
                <strong>Sell {holding.ticker} for USDG</strong>
                <small>Robinhood Chain · Uniswap V4</small>
              </div>
              <button
                aria-label="Close sale"
                disabled={busy}
                onClick={close}
                type="button"
              >
                ×
              </button>
            </header>

            {journeyStage !== "idle" && (
              <SellJourney
                approvalRequired={approvalRequired}
                audit={audit}
                journeyStage={journeyStage}
                permitRequired={permitRequired}
                quote={quote}
                result={result}
                ticker={holding.ticker}
              />
            )}

            {!result && (
              <>
                <div className="sellAmount">
                  <span>Amount to sell</span>
                  <strong>
                    {tokenAmount} {holding.ticker}
                  </strong>
                  <small>
                    {percentage}% of this wallet position
                  </small>
                </div>
                <div
                  aria-label="Percentage of position"
                  className="sellPercentages"
                  role="group"
                >
                  {percentages.map((option) => (
                    <button
                      aria-pressed={percentage === option}
                      disabled={busy}
                      key={option}
                      onClick={() => choosePercentage(option)}
                      type="button"
                    >
                      {option}%
                    </button>
                  ))}
                </div>

                {quote && (
                  <dl className="sellQuote">
                    <div>
                      <dt>Expected return</dt>
                      <dd>{formatUnits(BigInt(quote.amountOut), 6)} USDG</dd>
                    </div>
                    <div>
                      <dt>Route</dt>
                      <dd>{quote.routing} · V4 only</dd>
                    </div>
                    <div>
                      <dt>Request ID</dt>
                      <dd title={quote.requestId}>
                        {short(quote.requestId)}
                      </dd>
                    </div>
                  </dl>
                )}

                <p className="sellNotice">
                  Your wallet approves the stock token, signs the bounded
                  Permit2 message and submits the Uniswap transaction.
                </p>
              </>
            )}

            {result && (
              <div className="sellResult">
                <span>Sale confirmed</span>
                <strong>
                  {formatUnits(BigInt(result.amountOut), 6)} USDG
                </strong>
                <small>Received by your connected wallet</small>
                {audit && (
                  <p className="sellAuditStatus">
                    Evidence saved · The Graph{" "}
                    {audit.graph.response.status}
                  </p>
                )}
                <nav aria-label="Sale evidence">
                  <a
                    href={transactionUrl(result.transactionHash)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Transaction
                  </a>
                  <a
                    href={transactionEventsUrl(result.transactionHash)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Event logs
                  </a>
                  <a
                    href={blockUrl(result.blockNumber)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Block
                  </a>
                  {audit && (
                    <GraphEvidenceModal
                      fallback={{
                        ticker: result.ticker,
                        chainId: "eip155:4663",
                        protocol: "v4",
                        ...audit.graph.response,
                      }}
                      expectedTransaction={result.transactionHash}
                      ticker={result.ticker}
                    />
                  )}
                </nav>
              </div>
            )}

            {error && <p className="sellError">{error}</p>}
            {!result && (
              <footer>
                <button
                  disabled={busy}
                  onClick={quote ? confirmSale : getQuote}
                  type="button"
                >
                  <span className="sellActionContent">
                    {busy && <i aria-hidden="true" />}
                    {busy
                      ? stageLabel(stage, quoting)
                      : quote
                        ? `Confirm ${holding.ticker} sale`
                        : "Get live quote"}
                  </span>
                </button>
                <button disabled={busy} onClick={close} type="button">
                  Cancel
                </button>
              </footer>
            )}
            {result && (
              <footer>
                <button onClick={close} type="button">
                  Done
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function SellJourney({
  journeyStage,
  approvalRequired,
  permitRequired,
  quote,
  result,
  audit,
  ticker,
}: {
  journeyStage: JourneyStage;
  approvalRequired: boolean;
  permitRequired: boolean;
  quote?: WalletSellQuote;
  result?: WalletSellResult;
  audit?: SaleAuditBundle;
  ticker: string;
}) {
  const quoteReady = !["idle", "quoting"].includes(journeyStage);
  const rank = journeyRank(journeyStage);
  const steps: Array<{
    label: string;
    detail: string;
    status: JourneyStatus;
    href?: string;
  }> = [
    {
      label: "Find the Uniswap V4 route",
      detail: quote
        ? `${formatUnits(BigInt(quote.amountOut), 6)} USDG expected · ${quote.routing}`
        : "Comparing live Robinhood Chain liquidity",
      status: journeyStage === "quoting" ? "active" : "complete",
    },
    {
      label: `Approve ${ticker} for Permit2`,
      detail: result?.approvalTransactionHash
        ? "Approval confirmed on Robinhood Chain"
        : approvalRequired
          ? "Your wallet grants only the required token allowance"
          : "Existing allowance is sufficient",
      status: optionalStatus(
        journeyStage,
        approvalRequired,
        "approving",
        rank > 1,
        quoteReady,
      ),
      href: result?.approvalTransactionHash
        ? transactionUrl(result.approvalTransactionHash)
        : undefined,
    },
    {
      label: "Sign the bounded Permit2 message",
      detail: permitRequired
        ? "Authorizes this exact Uniswap swap"
        : "No additional signature is required",
      status: optionalStatus(
        journeyStage,
        permitRequired,
        "signing",
        rank > 3,
        quoteReady,
      ),
    },
    {
      label: "Submit the Uniswap V4 sale",
      detail: result
        ? "Universal Router accepted the swap"
        : journeyStage === "refreshing"
          ? "Refreshing the route after approval"
          : "Building the protected wallet transaction",
      status:
        journeyStage === "refreshing" ||
        journeyStage === "building" ||
        journeyStage === "executing"
          ? "active"
          : rank > 4
            ? "complete"
            : "pending",
      href: result
        ? transactionUrl(result.transactionHash)
        : undefined,
    },
    {
      label: "Confirm on Robinhood Chain",
      detail: result
        ? `Finalized in block ${result.blockNumber}`
        : "Waiting for the network receipt",
      status:
        journeyStage === "confirming"
          ? "active"
          : result
            ? "complete"
            : "pending",
      href: result ? blockUrl(result.blockNumber) : undefined,
    },
    {
      label: "Index and save the evidence",
      detail: audit
        ? `The Graph ${audit.graph.response.status} · audit bundle sealed`
        : journeyStage === "evidence-error"
          ? "The sale is safe; the audit record needs attention"
          : "Matching the V4 pool and transaction with The Graph",
      status: audit
        ? "complete"
        : journeyStage === "recording"
          ? "active"
          : journeyStage === "evidence-error"
            ? "error"
            : "pending",
    },
  ];
  const completed = steps.filter((step) =>
    ["complete", "skipped"].includes(step.status),
  ).length;

  return (
    <section
      aria-label="Sale progress"
      aria-live="polite"
      className="sellJourney"
    >
      <header>
        <div>
          <span>Live execution</span>
          <strong>{journeyLabel(journeyStage)}</strong>
        </div>
        <small>
          {completed}/{steps.length} steps
        </small>
      </header>
      <div className="sellJourneyBar">
        <i style={{ width: `${(completed / steps.length) * 100}%` }} />
      </div>
      <ol>
        {steps.map((step) => (
          <li className={step.status} key={step.label}>
            <span aria-hidden="true">
              {step.status === "active" ? (
                <i />
              ) : step.status === "complete" ? (
                "✓"
              ) : step.status === "skipped" ? (
                "–"
              ) : step.status === "error" ? (
                "!"
              ) : (
                ""
              )}
            </span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
            {step.href && (
              <a href={step.href} rel="noreferrer" target="_blank">
                View
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function optionalStatus(
  stage: JourneyStage,
  required: boolean,
  activeStage: JourneyStage,
  completed: boolean,
  quoteReady: boolean,
): JourneyStatus {
  if (stage === activeStage) return "active";
  if (!required && quoteReady) return "skipped";
  if (completed) return "complete";
  return "pending";
}

function journeyRank(stage: JourneyStage): number {
  return {
    idle: 0,
    quoting: 0,
    quoted: 0,
    approving: 1,
    refreshing: 2,
    signing: 3,
    building: 4,
    executing: 4,
    confirming: 5,
    recording: 6,
    complete: 7,
    "evidence-error": 7,
  }[stage];
}

function journeyLabel(stage: JourneyStage): string {
  return {
    idle: "Ready",
    quoting: "Finding the best route",
    quoted: "Quote ready for review",
    approving: "Waiting for token approval",
    refreshing: "Refreshing the protected route",
    signing: "Waiting for your signature",
    building: "Preparing the Uniswap sale",
    executing: "Waiting for wallet confirmation",
    confirming: "Confirming on Robinhood Chain",
    recording: "Saving verifiable evidence",
    complete: "Sale and evidence complete",
    "evidence-error": "Sale complete · evidence needs attention",
  }[stage];
}

function stageLabel(stage: SellStage, quoting: boolean): string {
  if (quoting) return "Finding V4 route...";
  return {
    idle: "Preparing...",
    approving: "Approve stock token...",
    refreshing: "Refreshing quote...",
    signing: "Sign Permit2...",
    building: "Building sale...",
    executing: "Confirm Uniswap sale...",
    confirming: "Waiting for Robinhood Chain...",
    recording: "Saving audit evidence...",
  }[stage];
}

function short(value: string): string {
  return value.length > 18
    ? `${value.slice(0, 9)}…${value.slice(-6)}`
    : value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Sale failed";
}
