import { AppHeader } from "./app-header";
import { GoalFleetExperience } from "./goal-fleet-experience";
import { MarketCatalog } from "./market-catalog";

const journey = [
  {
    title: "Define the goal",
    copy: "Share the purpose, time horizon, liquidity need and risk comfort.",
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
            <span className="eyebrow">Agent decision intelligence</span>
            <h1>
              Start with the goal.
              <br />
              <em>Get a decision you can verify.</em>
            </h1>
            <p>
              Four specialized agents turn your circumstances into an
              explainable comparison. They may recommend a candidate, limit
              the position, or tell you to wait.
            </p>
          </div>

          <aside className="statusCard">
            <span>Current milestone</span>
            <strong>Goal-first consultation</strong>
            <p>The fleet wakes on demand and hibernates after inactivity.</p>
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
