import { AccessButton } from "./access-button";
import { MarketCatalog } from "./market-catalog";

const journey = [
  {
    title: "Define the goal",
    copy: "Describe the outcome, budget and risk level in plain language.",
  },
  {
    title: "Compare candidates",
    copy: "The fleet evaluates supported stock tokens and policy evidence.",
  },
  {
    title: "Review the result",
    copy: "See the recommendation, execution status and transaction trail.",
  },
];

const roles = [
  {
    mark: "S",
    name: "Scout",
    copy: "Finds eligible markets and gathers evidence.",
    rail: "Uniswap and The Graph",
  },
  {
    mark: "R",
    name: "Risk",
    copy: "Checks policy, liquidity and execution limits.",
    rail: "ENS policy",
  },
  {
    mark: "T",
    name: "Trader",
    copy: "Prepares an approved and bounded stock token trade.",
    rail: "Uniswap execution",
  },
  {
    mark: "A",
    name: "Auditor",
    copy: "Reconciles the final decision and transaction evidence.",
    rail: "The Graph evidence",
  },
];

export default function HomePage() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">E</span>
          <div className="brandCopy">
            <strong>EQLTY</strong>
            <span>Agent powered investing</span>
          </div>
        </div>
        <div className="topbarActions">
          <span className="network">
            <i />
            Robinhood Chain
          </span>
          <AccessButton />
        </div>
      </header>

      <main className="content">
        <section className="hero">
          <div>
            <span className="eyebrow">Stock tokens with clear boundaries</span>
            <h1>
              Set the goal.
              <br />
              <em>Let the fleet compare.</em>
            </h1>
            <p>
              Four specialized agents turn an investment objective into a
              recommendation with readable policy and verifiable evidence.
            </p>
          </div>

          <aside className="statusCard">
            <span>Current milestone</span>
            <strong>Market discovery</strong>
            <p>The app now reads live stock token availability and routes.</p>
            <div className="meter">
              <i />
            </div>
          </aside>
        </section>

        <section className="journey" aria-label="Product journey">
          {journey.map((step, index) => (
            <article key={step.title}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <strong>{step.title}</strong>
              <p>{step.copy}</p>
            </article>
          ))}
        </section>

        <MarketCatalog />

        <section className="fleet">
          <header className="fleetHeader">
            <div>
              <span className="eyebrow">Specialized by design</span>
              <h2>One fleet, four responsibilities</h2>
            </div>
            <span>PerkOS Hermes runtimes</span>
          </header>

          <div className="fleetGrid">
            {roles.map((role) => (
              <article key={role.name}>
                <span className="roleMark">{role.mark}</span>
                <strong>{role.name}</strong>
                <p>{role.copy}</p>
                <small>{role.rail}</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
