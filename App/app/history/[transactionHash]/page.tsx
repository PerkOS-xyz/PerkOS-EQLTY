"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "../../app-header";
import {
  AuditRequestError,
  loadPurchaseAudit,
} from "../../../lib/audit-api";
import {
  dateTime,
  shortHash,
  tokenAmount,
} from "../../../lib/audit-format";
import type { PurchaseAuditBundle } from "../../../lib/audit-types";
import {
  addressUrl,
  blockUrl,
  graphEvidenceUrl,
  transactionEventsUrl,
  transactionUrl,
} from "../../../lib/execution-api";

export default function PurchaseAuditPage() {
  const params = useParams<{ transactionHash: string }>();
  const hash = params.transactionHash;
  const [bundle, setBundle] = useState<PurchaseAuditBundle>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setBundle(undefined);
    setError(undefined);
    loadPurchaseAudit(hash, controller.signal)
      .then(setBundle)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof AuditRequestError && reason.status === 404) {
          setError(
            "This purchase predates database-backed audit capture. Its onchain transaction remains verifiable.",
          );
          return;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "Purchase evidence is unavailable.",
        );
      });
    return () => controller.abort();
  }, [hash]);

  return (
    <div className="shell">
      <AppHeader active="history" />
      <main className="auditContent auditDetailContent">
        <Link className="auditBack" href="/history">
          ← Purchase history
        </Link>
        {!bundle && !error && (
          <AuditDetailState
            copy="Loading the immutable record and matching it with Robinhood Chain."
            title="Reading audit bundle"
          />
        )}
        {!bundle && error && (
          <AuditDetailState
            copy={error}
            hash={hash}
            title="Audit bundle unavailable"
          />
        )}
        {bundle && <PurchaseAudit bundle={bundle} />}
      </main>
    </div>
  );
}

function PurchaseAudit({ bundle }: { bundle: PurchaseAuditBundle }) {
  const graph = bundle.graph.response;
  const evidenceName = graph.source === "robinhood-rpc"
    ? "Robinhood Chain RPC"
    : "The Graph Substreams";
  const graphPoolRelationship =
    bundle.uniswap.graphPoolRelationship ??
    (bundle.uniswap.poolMatchedGraphEvidence
      ? "same-pool"
      : "independent-market-pool");
  const transactionTrail: Array<[string, string, string]> = [
    [
      "1",
      "Strategy created",
      bundle.strategy.setupTransactions.creation,
    ],
    ["2", "USDG approved", bundle.strategy.setupTransactions.approval],
    ["3", "Strategy funded", bundle.strategy.setupTransactions.funding],
    ["4", "Uniswap executed", bundle.transactionHash],
  ];
  return (
    <>
      <section className="auditDetailHero">
        <div>
          <span className="eyebrow">Immutable execution record</span>
          <h1>{bundle.ticker} purchase proof</h1>
          <p>
            The database record preserves the exact agent evidence. The
            transaction, pool and transfers remain independently verifiable
            on Robinhood Chain.
          </p>
        </div>
        <div className="auditSeal">
          <span>Bundle integrity</span>
          <strong>Stored</strong>
          <code title={bundle.bundleHash}>{shortHash(bundle.bundleHash)}</code>
        </div>
      </section>

      <section aria-label="Audit verification summary" className="auditChecks">
        <AuditCheck copy="Receipt and token transfers" label="Onchain" />
        <AuditCheck copy="Router, PoolManager and poolId" label="Uniswap V4" />
        <AuditCheck
          copy="Pre-trade market evidence and checkpoint"
          label={evidenceName}
        />
        <AuditCheck copy="Wallet-scoped immutable document" label="Firestore" />
      </section>

      <section className="auditOverview">
        <div>
          <span>Spent</span>
          <strong>{tokenAmount(bundle.strategy.amountIn, 6)} USDG</strong>
        </div>
        <i>→</i>
        <div>
          <span>Quoted output</span>
          <strong>
            {tokenAmount(bundle.uniswap.quotedAmountOut, 18)} {bundle.ticker}
          </strong>
        </div>
        <div>
          <span>Block</span>
          <strong>{bundle.receipt.blockNumber}</strong>
        </div>
        <div>
          <span>Recorded</span>
          <strong>{dateTime(bundle.recordedAt)}</strong>
        </div>
      </section>

      <section className="auditSection">
        <SectionHeading
          copy="All wallet setup operations and the guarded Hermes execution."
          title="Transaction trail"
        />
        <div className="auditTrail">
          {transactionTrail.map(([number, label, transaction]) => (
            <a
              href={transactionUrl(transaction)}
              key={label}
              rel="noreferrer"
              target="_blank"
            >
              <i>{number}</i>
              <span>
                <strong>{label}</strong>
                <code>{shortHash(transaction)}</code>
              </span>
              <b>Verify ↗</b>
            </a>
          ))}
        </div>
      </section>

      <div className="auditEvidenceColumns">
        <section className="auditEvidenceCard uniswap">
          <header>
            <span>Execution venue</span>
            <strong>Uniswap V4</strong>
            <b>{bundle.uniswap.routing}</b>
          </header>
          <EvidenceRow label="Quote request" value={bundle.uniswap.requestId} />
          <EvidenceRow label="Router" value={bundle.uniswap.router} />
          <EvidenceRow
            label="PoolManager"
            value={bundle.uniswap.poolManager}
          />
          <EvidenceRow label="Pool ID" value={bundle.uniswap.poolId} />
          <EvidenceRow
            label="Onchain evidence"
            value={
              graphPoolRelationship === "same-pool"
                ? "Same V4 pool"
                : "Independent pre-trade pool"
            }
          />
          <footer>
            <a
              href={addressUrl(bundle.uniswap.poolManager)}
              rel="noreferrer"
              target="_blank"
            >
              PoolManager
            </a>
            <a
              href={transactionEventsUrl(bundle.transactionHash)}
              rel="noreferrer"
              target="_blank"
            >
              Swap event
            </a>
          </footer>
        </section>

        <section className="auditEvidenceCard graph">
          <header>
            <span>Risk evidence</span>
            <strong>{evidenceName}</strong>
            <b>{graph.module ?? "map_pool_events"}</b>
          </header>
          <div className="graphCall">
            <span>Actual server request</span>
            <code>
              {bundle.graph.request.method} {bundle.graph.request.endpoint}
              {"\n"}
              {JSON.stringify(bundle.graph.request.body, null, 2)}
            </code>
          </div>
          <p>
            {evidenceName} supplied the pre-trade liquidity and price evidence
            used by the agents. The confirmed receipt independently records
            the V4 pool selected by Uniswap for execution.
          </p>
          <EvidenceRow
            label="Evidence source"
            value={graph.package ?? graph.module ?? evidenceName}
          />
          <EvidenceRow label="Provider" value={graph.provider ?? "Configured"} />
          <EvidenceRow label="Evidence block" value={graph.evidenceBlock} />
          <EvidenceRow
            label="Checkpoint / head"
            value={`${graph.checkpointBlock ?? graph.processedBlock ?? "—"} / ${graph.headBlock ?? "—"}`}
          />
          <EvidenceRow label="Stream lag" value={`${graph.lagBlocks ?? 0} blocks`} />
          <footer>
            <a
              href={graphEvidenceUrl(bundle.ticker)}
              rel="noreferrer"
              target="_blank"
            >
              Live JSON
            </a>
            {graph.evidenceTransaction && (
              <a
                href={transactionEventsUrl(graph.evidenceTransaction)}
                rel="noreferrer"
                target="_blank"
              >
                Source event
              </a>
            )}
          </footer>
        </section>
      </div>

      <section className="auditSection">
        <SectionHeading
          copy="ERC-20 movements decoded from the confirmed execution receipt."
          title="Token transfers"
        />
        <div className="transferTable">
          <header>
            <span>Token</span>
            <span>From</span>
            <span>To</span>
            <span>Amount</span>
            <span>Log</span>
          </header>
          {bundle.transfers.map((transfer) => (
            <div key={`${transfer.logIndex}-${transfer.token}`}>
              <strong>{transfer.symbol}</strong>
              <code title={transfer.from}>{shortHash(transfer.from)}</code>
              <code title={transfer.to}>{shortHash(transfer.to)}</code>
              <span>
                {tokenAmount(
                  transfer.amount,
                  transfer.symbol === "USDG" ? 6 : 18,
                )}
              </span>
              <a
                href={transactionEventsUrl(bundle.transactionHash)}
                rel="noreferrer"
                target="_blank"
              >
                #{transfer.logIndex} ↗
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="auditSection">
        <SectionHeading
          copy="The stored evidence can be hashed again and compared with these commitments."
          title="Proof commitments"
        />
        <div className="proofCommitments">
          <EvidenceRow label="Audit bundle" value={bundle.bundleHash} />
          {bundle.proofs.decisionReceipt && (
            <>
              <EvidenceRow
                label="Decision receipt"
                value={bundle.proofs.decisionReceipt.id}
              />
              <EvidenceRow
                label="Decision root"
                value={bundle.proofs.decisionReceipt.root}
              />
            </>
          )}
          <EvidenceRow label="Proof root" value={bundle.proofs.proofBundleRoot ?? "—"} />
          <EvidenceRow label="Signal hash" value={bundle.proofs.signalHash} />
          <EvidenceRow label="Quote hash" value={bundle.proofs.quoteHash} />
          <EvidenceRow label="ENS manifest" value={bundle.ens.manifestHash ?? "—"} />
        </div>
        <footer className="auditPrimaryLinks">
          <a
            href={transactionUrl(bundle.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            Open transaction
          </a>
          <a
            href={transactionEventsUrl(bundle.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            Inspect event logs
          </a>
          <a
            href={blockUrl(bundle.receipt.blockNumber)}
            rel="noreferrer"
            target="_blank"
          >
            Open block {bundle.receipt.blockNumber}
          </a>
        </footer>
      </section>
    </>
  );
}

function AuditCheck({ label, copy }: { label: string; copy: string }) {
  return (
    <article>
      <i>✓</i>
      <span>
        <strong>{label}</strong>
        <small>{copy}</small>
      </span>
    </article>
  );
}

function SectionHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <header className="auditSectionHeading">
      <strong>{title}</strong>
      <span>{copy}</span>
    </header>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="evidenceRow">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function AuditDetailState({
  title,
  copy,
  hash,
}: {
  title: string;
  copy: string;
  hash?: string;
}) {
  return (
    <section className="auditState busy">
      <i />
      <strong>{title}</strong>
      <p>{copy}</p>
      {hash && (
        <a href={transactionUrl(hash)} rel="noreferrer" target="_blank">
          Verify transaction
        </a>
      )}
    </section>
  );
}
