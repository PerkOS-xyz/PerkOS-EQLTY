import { AppHeader } from "./app-header";
import { GoalFleetExperience } from "./goal-fleet-experience";
import { MarketCatalog } from "./market-catalog";

const journey = [
  {
    title: "Ask the fleet",
    copy: "Describe the outcome and let four specialized agents consult.",
  },
  {
    title: "Observe the decision",
    copy: "Follow ENS rules, candidate comparisons and the recommendation.",
  },
  {
    title: "Execute with proof",
    copy: "Approve optional Uniswap execution and verify it with The Graph.",
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
              State the goal.
              <br />
              <em>Watch the fleet decide.</em>
            </h1>
            <p>
              Four specialized agents turn an investment objective into a
              recommendation with readable policy and verifiable evidence.
            </p>
          </div>

          <aside className="statusCard">
            <span>Current milestone</span>
            <strong>Live agent consultation</strong>
            <p>Every recommendation carries policy, route and proof evidence.</p>
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
