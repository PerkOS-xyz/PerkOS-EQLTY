"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readDecisionFeeConfig } from "../../lib/goal-api";
import {
  loadIntegrationHealth,
  loadStockCatalog,
  type GraphIntegrationHealth,
} from "../../lib/market-api";
import type { StockCatalog } from "../../lib/market-types";

const slides = ["opening", "conversation", "proof", "market", "business", "demo"];
const roles = [
  { role: "Scout", action: "Discovers candidates", proof: "The Graph + ENS" },
  { role: "Risk", action: "Challenges or stops", proof: "Evidence + policy" },
  { role: "Trader", action: "Prepares the route", proof: "Uniswap + 1Claw" },
  { role: "Auditor", action: "Seals the decision", proof: "Receipt + events" },
];

type FeeConfig = Awaited<ReturnType<typeof readDecisionFeeConfig>>;

export function DeckPresenter() {
  const [catalog, setCatalog] = useState<StockCatalog>();
  const [graph, setGraph] = useState<GraphIntegrationHealth>();
  const [fees, setFees] = useState<FeeConfig>();

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      loadStockCatalog(false, controller.signal).then(setCatalog),
      loadIntegrationHealth(controller.signal).then(setGraph),
      readDecisionFeeConfig().then(setFees),
    ]);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowRight", "PageDown", "ArrowUp", "ArrowLeft", "PageUp"].includes(event.key)) return;
      const current = slides.findIndex((id) => {
        const rect = document.getElementById(id)?.getBoundingClientRect();
        return rect && Math.abs(rect.top) < window.innerHeight / 2;
      });
      const direction = ["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key) ? -1 : 1;
      const next = Math.min(slides.length - 1, Math.max(0, (current < 0 ? 0 : current) + direction));
      const nextSlide = slides[next];
      if (nextSlide) {
        document.getElementById(nextSlide)?.scrollIntoView({ behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, []);

  return (
    <main className="deckShell">
      <nav className="deckNav" aria-label="Presentation navigation">
        <Link href="/" className="deckBrand">
          <img alt="" src="/eqlty-logo-mark.png" />
          <span><b>EQLTY</b><small>PerkOS product</small></span>
        </Link>
        <div>
          {slides.map((slide, index) => (
            <a href={`#${slide}`} key={slide} aria-label={`Slide ${index + 1}`}>{index + 1}</a>
          ))}
        </div>
        <Link href="/" className="deckOpen">Open product ↗</Link>
      </nav>

      <DeckSlide id="opening" number="01" eyebrow="The trust layer for tokenized stocks">
        <div className="deckHero">
          <div>
            <h1>Buying is solved.<br /><em>Trusting an agent is not.</em></h1>
            <p>EQLTY turns a financial goal into one decision that can be challenged, constrained and verified before money moves.</p>
          </div>
          <aside>
            <span>Four agents</span><b>One accountable decision</b>
            <ul><li>Agents recommend</li><li>Rules constrain</li><li>You approve</li><li>The chain proves</li></ul>
          </aside>
        </div>
      </DeckSlide>

      <DeckSlide id="conversation" number="02" eyebrow="Talk to the fleet">
        <div className="deckConversation">
          <div className="deckQuestion">
            <span>You</span>
            <p>“Compare a limited Stock Token position for long-term growth. I may need the funds and prefer medium risk.”</p>
          </div>
          <div>
            <h2>Not one black-box answer.<br /><em>A visible deliberation.</em></h2>
            <div className="deckRoles">
              {roles.map((item, index) => (
                <article key={item.role}><i>0{index + 1}</i><strong>{item.role}</strong><span>{item.action}</span><small>{item.proof}</small></article>
              ))}
            </div>
            <p className="deckOutcome">Every cycle returns a primary option, an alternative and the case for doing nothing.</p>
          </div>
        </div>
      </DeckSlide>

      <DeckSlide id="proof" number="03" eyebrow="The recommendation has a proof path">
        <h2>Every sponsor is <em>load-bearing.</em></h2>
        <div className="deckProofRail">
          <ProofStep label="ENS" title="Defines behavior" copy="Per-user agent identities, allowed assets and limits. Change a record; change the next cycle." />
          <ProofStep label="The Graph" title="Proves the evidence" copy="Live Substreams data can advance or block a candidate. No fresh evidence, no recommendation." />
          <ProofStep label="Uniswap" title="Prepares execution" copy="A fresh API quote supplies the route and request ID. Risk binds the approved calldata." />
          <ProofStep label="EQLTY Vault" title="Enforces approval" copy="Amount, slippage, deadline, nonce and signature are checked onchain before execution." />
        </div>
        <div className="deckGuardrail">Only Trader can spend · 1Claw controls its rail · the owner signs the final action</div>
      </DeckSlide>

      <DeckSlide id="market" number="04" eyebrow="A focused wedge">
        <div className="deckMarket">
          <div>
            <h2>Exchanges execute.<br />Assistants suggest.<br /><em>EQLTY makes decisions accountable.</em></h2>
            <p>The underserved layer sits between an AI opinion and an irreversible transaction: independent roles, portable policy and evidence a user can inspect.</p>
            <p className="deckAudience"><b>Initial audience</b> Self-directed users in LatAm and Africa who can legally access tokenized assets and want verifiable guidance before execution.</p>
          </div>
          <div className="deckLive" aria-label="Live product coverage">
            <span>Live product coverage</span>
            <Metric value={catalog?.summary.total} label="Robinhood Stock Tokens discovered" />
            <Metric value={catalog?.summary.routed} label="Uniswap markets observed" />
            <Metric value={graph?.observedTickers} label="Tickers indexed by The Graph" />
            <footer><i className={graph?.status === "ready" ? "ready" : ""} />{graph ? `Graph ${graph.status} · lag ${graph.lagBlocks ?? "—"}` : "Loading live evidence"}</footer>
          </div>
        </div>
      </DeckSlide>

      <DeckSlide id="business" number="05" eyebrow="Usage-based revenue">
        <h2>Users pay for a verified decision.<br /><em>Not for a promise.</em></h2>
        <div className="deckRevenue">
          <article><span>Start</span><b>Free</b><p>Ask the fleet, define the goal and preview how the committee works.</p></article>
          <article><span>Recommendation</span><b>{fees ? `${usdG(fees.completeAmount)} USDG` : "—"}</b><p>A complete four-agent Decision Receipt backed by live policy and evidence.</p></article>
          <article><span>No action</span><b>{fees ? `${usdG(fees.noCandidateAmount)} USDG` : "—"}</b><p>A lower fee when the verified answer is that no candidate should advance.</p></article>
          <article><span>Settlement</span><b>x402</b><p>Exact wallet authorization bound to the receipt after value is produced.</p></article>
        </div>
        <p className="deckExpansion">Expansion: recurring goal reviews, protected execution and a decision API for wallets and fintech apps.</p>
      </DeckSlide>

      <DeckSlide id="demo" number="06" eyebrow="See it work">
        <div className="deckClose">
          <div>
            <h2>Ask. Challenge.<br />Verify. <em>Then decide.</em></h2>
            <p>The product is not the trade. It is knowing why an option advanced, why another stopped and which rules protected the user.</p>
            <div><Link href="/">Start a consultation</Link><Link href="/history">Open decision history</Link></div>
          </div>
          <ol><li><b>01</b>Ask the fleet</li><li><b>02</b>Watch agents disagree</li><li><b>03</b>Open sponsor evidence</li><li><b>04</b>Approve only if convinced</li></ol>
        </div>
      </DeckSlide>
    </main>
  );
}

function DeckSlide({ children, eyebrow, id, number }: { children: React.ReactNode; eyebrow: string; id: string; number: string }) {
  return <section className="deckSlide" id={id}><div className="deckFrame"><header><span>{number}</span><p>{eyebrow}</p></header>{children}</div></section>;
}

function ProofStep({ copy, label, title }: { copy: string; label: string; title: string }) {
  return <article><span>{label}</span><strong>{title}</strong><p>{copy}</p></article>;
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div><b>{value ?? "—"}</b><span>{label}</span></div>;
}

function usdG(value: string): string {
  return (Number(value) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
