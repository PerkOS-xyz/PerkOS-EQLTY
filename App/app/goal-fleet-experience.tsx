"use client";

import { FleetPanel } from "./fleet-panel";
import { GoalAnalyzer } from "./goal-analyzer";
import { useFleetActivation } from "./use-fleet-activation";
import { useGoalAnalysis } from "./use-goal-analysis";

export function GoalFleetExperience() {
  const fleet = useFleetActivation();
  const goal = useGoalAnalysis(fleet.activate);

  return (
    <div className="goalFleetExperience">
      <GoalAnalyzer fleet={fleet} state={goal} />
      <FleetPanel fleet={fleet} goal={goal} showFundingAction={false} />
    </div>
  );
}
