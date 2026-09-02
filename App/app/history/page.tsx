"use client";

import Link from "next/link";
import { AppHeader } from "../app-header";
import { useAuditResource } from "../use-audit-resource";
import { loadPurchaseHistory } from "../../lib/audit-api";
import {
  dateTime,
  shortHash,
  tokenAmount,
} from "../../lib/audit-format";
import type {
  PurchaseHistoryEntry,
  SaleAuditBundle,
} from "../../lib/audit-types";
import {
  addressUrl,
  blockUrl,
  transactionEventsUrl,
  transactionUrl,
} from "../../lib/execution-api";
import { GraphEvidenceModal } from "../graph-evidence-modal";

export default function HistoryPage() {
  const state = useAuditResource(loadPurchaseHistory);
  const history = state.data;
  const trades = history
    ? [
        ...history.entries.map((entry) => ({
          kind: "purchase" as const,
          at: entry.executedAt,
          entry,
        })),
        ...history.sales.map((entry) => ({
          kind: "sale" as const,
          at: entry.recordedAt,
          entry,
        })),
      ].sort((left, right) => right.at.localeCompare(left.at))
    : [];

  return (
    <div className="shell">
      <AppHeader active="history" />
      <main className="auditContent">
        <section className="auditHero">
          <div>
            <span className="eyebrow">Onchain audit trail</span>
            <h1>Trade history</h1>
            <p>
              Every EQLTY purchase and sale can be independently verified on
              Robinhood Chain, Uniswap and The Graph.
            </p>
          </div>
          <div className="auditHeroMetric">
            <span>Completed trades</span>
            <strong>{history ? trades.length : "—"}</strong>
            <small>Wallet and vault evidence</small>
          </div>
        </section>

        {state.phase === "disconnected" && (
          <AuditState
            copy="Connect the wallet used for EQLTY purchases."
            title="Connect your wallet"
          />
        )}
        {state.phase === "loading" && (
          <AuditState
            busy
            copy="Reading verified execution events from Robinhood Chain."
            title="Loading trade records"
          />
        )}
        {state.phase === "authenticating" && (
          <AuditState
            busy
            copy="Confirm the EQLTY ownership message in your wallet. This does not move funds."
            title="Confirm wallet ownership"
          />
        )}
        {state.phase === "error" && (
          <AuditState
            action={state.refresh}
            actionLabel="Try again"
            copy={state.error ?? "Purchase history is unavailable."}
            title="History needs attention"
          />
        )}
        {state.phase === "ready" && history?.status === "pending" && (
          trades.length === 0 && (
            <AuditState
              copy="The final EQLTY vault must be deployed before onchain purchase records are available."
              title="Vault history is pending"
            />
          )
        )}
        {state.phase === "ready" &&
          history?.status === "ready" &&
          trades.length === 0 && (
            <AuditState
              copy="Your first completed trade will appear here with its transaction, event log and proof evidence."
              title="No trades yet"
            />
          )}

        {history && trades.length > 0 && (
          <>
            <div className="auditToolbar">
              <div>
                <strong>Verified trades</strong>
                <span>Newest first</span>
              </div>
              {history.vault && (
                <a
                  href={addressUrl(history.vault)}
                  rel="noreferrer"
                  target="_blank"
                >
                  View EQLTY vault
                </a>
              )}
            </div>
            <section aria-label="Trade records" className="historyList">
              {trades.map((trade) =>
                trade.kind === "purchase" ? (
                  <PurchaseCard
                    entry={trade.entry}
                    key={`purchase-${trade.entry.transactionHash}`}
                  />
                ) : (
                  <SaleCard
                    entry={trade.entry}
                    key={`sale-${trade.entry.transactionHash}`}
                  />
                ),
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SaleCard({ entry }: { entry: SaleAuditBundle }) {
  return (
    <article className="historyCard">
      <header>
        <span className="assetMonogram">
          {entry.ticker.slice(0, 1)}
        </span>
        <div>
          <span>Sold</span>
          <strong>{entry.ticker}</strong>
          <small>{dateTime(entry.recordedAt)}</small>
        </div>
        <b>
          {entry.graph.response.saleObserved
            ? "Graph verified"
            : "Confirmed"}
        </b>
      </header>
      <div className="purchaseFlow">
        <span>
          <small>Sold</small>
          <strong>
            {tokenAmount(
              entry.trade.amountIn,
              entry.trade.tokenInDecimals,
            )}{" "}
            {entry.ticker}
          </strong>
        </span>
        <i>→</i>
        <span>
          <small>Received</small>
          <strong>
            {tokenAmount(entry.trade.actualAmountOut, 6)} USDG
          </strong>
        </span>
      </div>
      <dl className="proofHashes">
        <div>
          <dt>Uniswap V4 pool</dt>
          <dd title={entry.graph.response.salePoolId}>
            {shortHash(entry.graph.response.salePoolId)}
          </dd>
        </div>
        <div>
          <dt>The Graph</dt>
          <dd>{entry.graph.response.status}</dd>
        </div>
        <div>
          <dt>Audit bundle</dt>
          <dd title={entry.bundleHash}>
            {shortHash(entry.bundleHash)}
          </dd>
        </div>
      </dl>
      <footer>
        <a
          href={transactionUrl(entry.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          Transaction
        </a>
        <a
          href={transactionEventsUrl(entry.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          Event logs
        </a>
        <a
          href={blockUrl(entry.receipt.blockNumber)}
          rel="noreferrer"
          target="_blank"
        >
          Block {entry.receipt.blockNumber}
        </a>
        <GraphEvidenceModal
          fallback={{
            ticker: entry.ticker,
            chainId: "eip155:4663",
            protocol: "v4",
            ...entry.graph.response,
          }}
          expectedTransaction={entry.transactionHash}
          ticker={entry.ticker}
        />
      </footer>
    </article>
  );
}

function PurchaseCard({ entry }: { entry: PurchaseHistoryEntry }) {
  const ticker = entry.ticker ?? "Stock token";
  const output =
    entry.outputDecimals === undefined
      ? entry.amountOut
      : tokenAmount(entry.amountOut, entry.outputDecimals);

  return (
    <article className="historyCard">
      <header>
        <span className="assetMonogram">{ticker.slice(0, 1)}</span>
        <div>
          <span>Executed</span>
          <strong>{ticker}</strong>
          <small>{dateTime(entry.executedAt)}</small>
        </div>
        <b>Confirmed</b>
      </header>
      <div className="purchaseFlow">
        <span>
          <small>Spent</small>
          <strong>{tokenAmount(entry.amountIn, 6)} USDG</strong>
        </span>
        <i>→</i>
        <span>
          <small>Received</small>
          <strong>
            {output} {ticker}
          </strong>
        </span>
      </div>
      <dl className="proofHashes">
        <div>
          <dt>Signal proof</dt>
          <dd title={entry.signalHash}>{shortHash(entry.signalHash)}</dd>
        </div>
        <div>
          <dt>Quote proof</dt>
          <dd title={entry.quoteHash}>{shortHash(entry.quoteHash)}</dd>
        </div>
        <div>
          <dt>Strategy / nonce</dt>
          <dd>
            #{entry.strategyId} / {entry.nonce}
          </dd>
        </div>
      </dl>
      <footer>
        <Link href={`/history/${entry.transactionHash}`}>
          Audit details
        </Link>
        <a
          href={transactionUrl(entry.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          Transaction
        </a>
        <a
          href={transactionEventsUrl(entry.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          Event logs
        </a>
        <a
          href={blockUrl(entry.blockNumber)}
          rel="noreferrer"
          target="_blank"
        >
          Block {entry.blockNumber}
        </a>
      </footer>
    </article>
  );
}

function AuditState({
  title,
  copy,
  busy = false,
  action,
  actionLabel,
}: {
  title: string;
  copy: string;
  busy?: boolean;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <section className={`auditState ${busy ? "busy" : ""}`}>
      <i />
      <strong>{title}</strong>
      <p>{copy}</p>
      {action && (
        <button onClick={action} type="button">
          {actionLabel}
        </button>
      )}
      {!action && title === "Connect your wallet" && (
        <Link href="/">Return to app</Link>
      )}
    </section>
  );
}
