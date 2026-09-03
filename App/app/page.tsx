import { AppHeader } from "./app-header";
import { GoalFleetExperience } from "./goal-fleet-experience";
import { MarketCatalog } from "./market-catalog";

const journey = [
  {
    title: "Ask the fleet",
    copy: "Describe the outcome you want in your own words and set the boundaries.",
  },
  {
    title: "Compare choices",
    copy: "Watch four agents test alternatives against live evidence and ENS rules.",
  },
  {
    title: "Choose deliberately",
    copy: "Review a primary option, an alternative and the case for doing nothing.",
  },
];

export default function HomePage() {
  return (
    <div className="shell">
      <AppHeader active="home" />

      <main className="content">
        <section className="hero">
          <div>
            <span className="eyebrow">
              Verifiable decisions for tokenized stocks
            </span>
            <h1>
              Ask four agents.
              <br />
              <em>Get one decision you can verify.</em>
            </h1>
            <p>
              Talk to a financial assistant fleet that compares Stock Tokens,
              challenges its own recommendation and shows the evidence before
              you decide whether to act.
            </p>
          </div>

          <aside className="statusCard">
            <span>Current milestone</span>
            <strong>Human-approved agent decisions</strong>
            <p>Agents recommend. Rules constrain. You approve every trade.</p>
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

        <GoalFleetExperience />

        <MarketCatalog />
      </main>
    </div>
  );
}
