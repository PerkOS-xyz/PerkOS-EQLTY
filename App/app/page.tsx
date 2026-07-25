import { AppHeader } from "./app-header";
import { FleetPanel } from "./fleet-panel";
import { GoalAnalyzer } from "./goal-analyzer";
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

export default function HomePage() {
  return (
    <div className="shell">
      <AppHeader active="home" />

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

        <FleetPanel />

        <GoalAnalyzer />
      </main>
    </div>
  );
}
