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
import type { PurchaseHistoryEntry } from "../../lib/audit-types";
import {
  addressUrl,
  blockUrl,
  transactionEventsUrl,
  transactionUrl,
} from "../../lib/execution-api";

export default function HistoryPage() {
  const state = useAuditResource(loadPurchaseHistory);
  const history = state.data;

  return (
    <div className="shell">
      <AppHeader active="history" />
      <main className="auditContent">
        <section className="auditHero">
          <div>
            <span className="eyebrow">Onchain audit trail</span>
            <h1>Purchase history</h1>
            <p>
              Every completed EQLTY purchase can be independently verified on
              Robinhood Chain.
            </p>
          </div>
          <div className="auditHeroMetric">
            <span>Executed purchases</span>
            <strong>{history?.entries.length ?? "—"}</strong>
            <small>Rebuilt from vault events</small>
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
            title="Loading purchase records"
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
          <AuditState
            copy="The final EQLTY vault must be deployed before onchain purchase records are available."
            title="Vault history is pending"
          />
        )}
        {state.phase === "ready" &&
          history?.status === "ready" &&
          history.entries.length === 0 && (
            <AuditState
              copy="Your first completed purchase will appear here with its transaction, event log and proof hashes."
              title="No purchases yet"
            />
          )}

        {history?.status === "ready" && history.entries.length > 0 && (
          <>
            <div className="auditToolbar">
              <div>
                <strong>Verified executions</strong>
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
            <section aria-label="Purchase records" className="historyList">
              {history.entries.map((entry) => (
                <PurchaseCard entry={entry} key={entry.id} />
              ))}
            </section>
          </>
        )}
      </main>
    </div>
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
