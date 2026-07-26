"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  blockUrl,
  graphEvidenceUrl,
  loadGraphEvidence,
  transactionUrl,
} from "../lib/execution-api";

type EvidencePhase = "idle" | "loading" | "ready" | "fallback";

export function GraphEvidenceModal({
  ticker,
  fallback,
  expectedTransaction,
  children = "The Graph",
}: {
  ticker: string;
  fallback: Record<string, unknown>;
  expectedTransaction?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Record<string, unknown>>();
  const [phase, setPhase] = useState<EvidencePhase>("idle");
  const [copied, setCopied] = useState(false);
  const evidence = remote ?? fallback;
  const summary = useMemo(() => summarize(evidence), [evidence]);
  const json = useMemo(
    () => JSON.stringify(evidence, null, 2),
    [evidence],
  );

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function showEvidence() {
    setOpen(true);
    setCopied(false);
    if (remote || phase === "loading") return;
    setPhase("loading");
    try {
      const nextEvidence = await loadGraphEvidence(ticker);
      const nextTransaction = summarize(nextEvidence).transaction;
      if (
        expectedTransaction &&
        nextTransaction?.toLowerCase() !== expectedTransaction.toLowerCase()
      ) {
        setPhase("fallback");
        return;
      }
      setRemote(nextEvidence);
      setPhase("ready");
    } catch {
      setPhase("fallback");
    }
  }

  async function copyEvidence() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button
        className="graphEvidenceTrigger"
        onClick={showEvidence}
        type="button"
      >
        {children}
      </button>
      {open && (
        <div
          className="graphEvidenceBackdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-label={`${ticker} The Graph evidence`}
            aria-modal="true"
            className="graphEvidenceDialog"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">Verifiable market evidence</span>
                <strong>The Graph observation</strong>
                <small>{ticker} · Robinhood Chain · Uniswap V4</small>
              </div>
              <button
                aria-label="Close The Graph evidence"
                onClick={() => setOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>

            <div className={`graphEvidenceFreshness ${phase}`}>
              <i aria-hidden="true" />
              <span>
                {phase === "loading"
                  ? "Refreshing the live Substreams response"
                  : phase === "ready"
                    ? "Live API response"
                    : phase === "fallback"
                      ? "Stored audit response"
                      : "Verified evidence"}
              </span>
            </div>

            <dl className="graphEvidenceSummary">
              <div>
                <dt>Status</dt>
                <dd>{summary.status}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{summary.source}</dd>
              </div>
              <div>
                <dt>Block</dt>
                <dd>{summary.block ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>{summary.protocol}</dd>
              </div>
            </dl>

            <section className="graphEvidenceFacts">
              <EvidenceFact
                href={
                  summary.transaction
                    ? transactionUrl(summary.transaction)
                    : undefined
                }
                label="Observed transaction"
                value={summary.transaction}
              />
              <EvidenceFact label="Uniswap V4 pool" value={summary.poolId} />
              <EvidenceFact
                label="Pool manager"
                value={summary.poolManager}
              />
              <EvidenceFact
                label="Substreams module"
                value={summary.module}
              />
            </section>

            <details className="graphEvidenceJson" open>
              <summary>
                <span>Formatted response</span>
                <small>JSON</small>
              </summary>
              <pre>{json}</pre>
            </details>

            <footer>
              <button onClick={copyEvidence} type="button">
                {copied ? "Copied" : "Copy JSON"}
              </button>
              <a
                href={graphEvidenceUrl(ticker)}
                rel="noreferrer"
                target="_blank"
              >
                Open raw API
              </a>
              {summary.block && (
                <a
                  href={blockUrl(summary.block)}
                  rel="noreferrer"
                  target="_blank"
                >
                  View block
                </a>
              )}
              <button onClick={() => setOpen(false)} type="button">
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function EvidenceFact({
  label,
  value,
  href,
}: {
  label: string;
  value?: string;
  href?: string;
}) {
  return (
    <div>
      <span>{label}</span>
      {href && value ? (
        <a href={href} rel="noreferrer" target="_blank">
          {value}
        </a>
      ) : (
        <code>{value ?? "Not available"}</code>
      )}
    </div>
  );
}

function summarize(evidence: Record<string, unknown>) {
  return {
    status:
      text(evidence.status) ??
      (evidence.saleObserved === true ? "Observed" : "Verified"),
    source: text(evidence.source) ?? "The Graph Substreams",
    block:
      text(evidence.blockNumber) ??
      text(evidence.evidenceBlock) ??
      text(evidence.processedBlock),
    protocol: (text(evidence.protocol) ?? "Uniswap V4").toUpperCase(),
    transaction:
      text(evidence.transactionHash) ??
      text(evidence.saleTransaction) ??
      text(evidence.evidenceTransaction),
    poolId:
      text(evidence.poolIdentifier) ??
      text(evidence.salePoolId) ??
      text(evidence.poolId),
    poolManager:
      text(evidence.poolAddress) ??
      text(evidence.salePoolManager) ??
      text(evidence.poolManager),
    module: text(evidence.module) ?? "map_pool_events",
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
