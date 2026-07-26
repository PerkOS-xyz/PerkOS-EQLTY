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
  requestSellQuote,
  type WalletSellQuote,
} from "../../lib/sell-api";
import {
  executeWalletSell,
  type SellStage,
  type WalletSellResult,
} from "../../lib/wallet-sell";
import { useWalletAccess } from "../wallet-access-context";

const percentages = [25, 50, 100] as const;

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
  const [stage, setStage] = useState<SellStage>("idle");
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
    setError(undefined);
  }

  async function getQuote() {
    setQuoting(true);
    setError(undefined);
    setResult(undefined);
    try {
      setQuote(
        await requestSellQuote({
          ticker: holding.ticker,
          tokenIn: holding.tokenAddress,
          amountIn,
        }),
      );
    } catch (caught) {
      setError(message(caught));
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
        onStage: setStage,
      });
      setResult(completed);
      setQuote(undefined);
      onComplete();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setStage("idle");
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setQuote(undefined);
    setResult(undefined);
    setError(undefined);
    setPercentage(100);
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
                  {busy
                    ? stageLabel(stage, quoting)
                    : quote
                      ? `Confirm ${holding.ticker} sale`
                      : "Get live quote"}
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
