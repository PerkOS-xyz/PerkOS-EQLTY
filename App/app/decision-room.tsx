"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addressUrl,
  blockUrl,
  transactionEventsUrl,
} from "../lib/execution-api";
import { ensManagerUrl } from "../lib/fleet-api";
import type {
  ConsultationStep,
  OpportunityAnalysis,
  OpportunityCandidate,
} from "../lib/goal-types";
import { GraphEvidenceModal } from "./graph-evidence-modal";

type DecisionEvent = {
  actor: "ENS" | "Scout" | "Risk" | "Trader" | "Auditor";
  target: string;
  provider: "ENS" | "The Graph" | "EQLTY" | "Uniswap";
  title: string;
  detail: string;
  fact: string;
  links: Array<{ href: string; label: string }>;
  graphEvidence?: {
    ticker: string;
    fallback: Record<string, unknown>;
    transactionHash: string;
  };
  stopped?: boolean;
};

export function DecisionRoom({
  analysis,
}: {
  analysis: OpportunityAnalysis;
}) {
  const events = useMemo(() => decisionEvents(analysis), [analysis]);
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    setVisible(0);
    const interval = window.setInterval(() => {
      setVisible((current) => {
        if (current >= events.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 620);
    return () => window.clearInterval(interval);
  }, [analysis.id, events.length]);

  return (
    <section className="decisionRoom">
      <header>
        <div>
          <span>Agent decision room</span>
          <strong>See why the fleet reached this recommendation</strong>
          <small>
            Sealed cycle replay · analysis only · no funds moved
          </small>
        </div>
        <button onClick={() => setVisible(0)} type="button">
          Replay cycle
        </button>
      </header>

      <div className="decisionRoomGrid">
        <div aria-label="Agent consultation path" className="decisionMessages">
          {events.map((event, index) => {
            const state =
              index < visible
                ? "complete"
                : index === visible
                  ? "active"
                  : "waiting";
            return (
              <article
                className={`${state} ${event.stopped ? "stopped" : ""}`}
                key={`${event.actor}-${event.provider}`}
              >
                <div className="decisionActor">
                  <i>{event.actor.slice(0, 2)}</i>
                  <span>
                    <b>{event.actor}</b>
                    <small>to {event.target}</small>
                  </span>
                </div>
                <div className="decisionMessage">
                  <span>{event.provider}</span>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                  <code>{event.fact}</code>
                  {(event.links.length > 0 || event.graphEvidence) && (
                    <footer>
                      {event.links.map((link) => (
                        <a
                          href={link.href}
                          key={link.href}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {link.label} ↗
                        </a>
                      ))}
                      {event.graphEvidence && (
                        <GraphEvidenceModal
                          expectedTransaction={
                            event.graphEvidence.transactionHash
                          }
                          fallback={event.graphEvidence.fallback}
                          ticker={event.graphEvidence.ticker}
                        >
                          View Graph evidence
                        </GraphEvidenceModal>
                      )}
                    </footer>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="decisionConsole">
          <header>
            <span>Decision log</span>
            <b>{visible >= events.length ? "sealed" : "replaying"}</b>
          </header>
          <div aria-live="polite" role="log">
            {events.slice(0, visible).map((event, index) => (
              <p key={`${event.actor}-${index}`}>
                <time>0{index + 1}</time>
                <span>{event.actor}</span>
                {event.title}
              </p>
            ))}
            {visible === 0 && (
              <p className="consoleWaiting">
                <i />
                Loading sealed cycle…
              </p>
            )}
          </div>
          <footer>
            <span>Cycle ID</span>
            <code>{short(analysis.id)}</code>
            <span>Proof root</span>
            <code>{short(analysis.proofRoot)}</code>
          </footer>
        </aside>
      </div>
    </section>
  );
}

function decisionEvents(analysis: OpportunityAnalysis): DecisionEvent[] {
  const winner = analysis.candidates.find(
    (candidate) => candidate.status === "recommended",
  );
  const evidence = winner?.graphEvidence;
  const failed = analysis.candidates.find(
    (candidate) => candidate.status === "rejected",
  );
  const consultation = analysis.consultation;
  const ensLinks = analysis.policy.rootName
    ? [
        {
          href: ensManagerUrl(analysis.policy.rootName),
          label: "Open ENS name",
        },
      ]
    : [];

  return [
    {
      actor: "ENS",
      target: "Scout",
      provider: "ENS",
      title: `Policy ${policyVersion(analysis)} resolved`,
      detail: `${analysis.policy.allowedTickers.length} stock tokens are allowed. The fleet received the behavior policy before comparing markets.`,
      fact: `manifest ${short(analysis.policy.manifestHash ?? "local")} · ${
        analysis.policy.paused ? "paused" : "active"
      }`,
      links: ensLinks,
      stopped: analysis.policy.paused,
    },
    {
      actor: "Scout",
      target: "Risk",
      provider: "The Graph",
      title:
        consultation.scout.status === "verified"
          ? `${consultation.scout.agentName ?? "Scout Hermes"} selected ${consultation.scout.ticker}`
          : `${analysis.candidates.length} candidates compared`,
      detail:
        consultation.scout.summary ??
        (evidence
          ? `Substreams confirmed the latest Uniswap V4 event for ${winner?.ticker} before it entered the risk gate.`
          : "The scout compared the ENS-allowed universe, but no indexed route passed into the shortlist."),
      fact: consultationFact(
        consultation.scout,
        evidence
          ? `block ${evidence.blockNumber} · ${money(evidence.liquidityUsd)} indexed liquidity`
          : "indexed evidence unavailable",
      ),
      links: graphLinks(winner),
      graphEvidence: evidence
        ? {
            ticker: winner.ticker,
            fallback: { ...evidence, ticker: winner.ticker },
            transactionHash: evidence.transactionHash,
          }
        : undefined,
      stopped:
        consultation.scout.status === "invalid" ||
        (!evidence && consultation.scout.status !== "verified"),
    },
    {
      actor: "Risk",
      target: winner ? "Trader" : "User",
      provider: "EQLTY",
      title:
        consultation.risk.status === "verified"
          ? `${consultation.risk.agentName ?? "Risk Hermes"} approved ${consultation.risk.ticker}`
          : winner
            ? `${winner.ticker} passed the policy gates`
            : "The policy stopped this cycle",
      detail:
        consultation.risk.summary ??
        (winner
          ? `${winner.ticker} ranked first with score ${winner.score}. Its price deviation and indexed liquidity remained inside the ENS limits.`
          : failed?.reason ?? "No candidate met every active rule."),
      fact: consultationFact(
        consultation.risk,
        winner
          ? `${formatBps(winner.deviationBps)} · score ${winner.score}/100`
          : "no execution authorization",
      ),
      links: evidence
        ? [{ href: blockUrl(evidence.blockNumber), label: "Verify block" }]
        : [],
      stopped: !winner,
    },
    {
      actor: "Trader",
      target: winner ? "Auditor" : "User",
      provider: "Uniswap",
      title:
        consultation.trader.status === "verified"
          ? `${consultation.trader.agentName ?? "Trader Hermes"} prepared ${consultation.trader.ticker}`
          : winner
            ? `${winner.ticker} route prepared by policy engine`
            : "Execution path remains closed",
      detail:
        consultation.trader.summary ??
        (winner
          ? "The deterministic policy engine preserved the executable Uniswap quote. No Hermes Trader handoff was verified."
          : "No quote can advance when the recommendation is rejected."
        ),
      fact: consultationFact(
        consultation.trader,
        winner
          ? `${winner.uniswapRouting ?? "V4"} · request ${short(
              winner.uniswapRequestId ?? "pending",
            )}`
          : "no funds moved",
      ),
      links: evidence
        ? [
            {
              href: addressUrl(evidence.poolAddress),
              label: "Open V4 contract",
            },
          ]
        : [],
      stopped: !winner,
    },
    {
      actor: "Auditor",
      target: "User",
      provider: "EQLTY",
      title:
        consultation.auditor.status === "verified"
          ? `${consultation.auditor.agentName ?? "Auditor Hermes"} sealed ${consultation.auditor.ticker}`
          : winner
            ? `${winner.ticker} proof sealed by policy engine`
            : "Rejected cycle sealed",
      detail:
        consultation.auditor.summary ??
        (winner
          ? "The deterministic policy engine sealed the evidence because no Hermes Auditor handoff was verified."
          : "The auditor sealed the rejection reason so the stopped workflow remains auditable."
        ),
      fact: consultationFact(
        consultation.auditor,
        `proof ${short(analysis.proofRoot)}`,
      ),
      links: [],
      graphEvidence:
        winner && evidence
          ? {
              ticker: winner.ticker,
              fallback: { ...evidence, ticker: winner.ticker },
              transactionHash: evidence.transactionHash,
            }
          : undefined,
      stopped: !winner,
    },
  ];
}

function consultationFact(
  step: ConsultationStep,
  fallback: string,
): string {
  if (step.status !== "verified") {
    return step.detail ?? fallback;
  }
  const facts = step.facts
    .slice(0, 2)
    .map((fact) => `${fact.label} ${fact.value}`)
    .join(" · ");
  return `${facts} · A2A ${short(step.responseHash ?? "verified")}`;
}

function graphLinks(
  candidate?: OpportunityCandidate,
): Array<{ href: string; label: string }> {
  const evidence = candidate?.graphEvidence;
  if (!evidence) return [];
  return [
    {
      href: transactionEventsUrl(evidence.transactionHash),
      label: "Verify indexed event",
    },
  ];
}

function policyVersion(analysis: OpportunityAnalysis): string {
  return analysis.policy.version
    ? `v${analysis.policy.version}`
    : analysis.policy.source;
}

function formatBps(value?: number): string {
  return value === undefined ? "deviation unavailable" : `${value.toFixed(0)} bps`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

function short(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-6)}`;
}
