"use client";

import { FleetPanel } from "./fleet-panel";
import { GoalAnalyzer } from "./goal-analyzer";
import { useGoalAnalysis } from "./use-goal-analysis";

export function GoalFleetExperience() {
  const goal = useGoalAnalysis();

  return (
    <div className="goalFleetExperience">
      <GoalAnalyzer state={goal} />
      <FleetPanel goal={goal} />
    </div>
  );
}
