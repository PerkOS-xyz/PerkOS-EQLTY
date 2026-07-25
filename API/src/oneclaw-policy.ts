import type { FleetRole } from "./fleet-types.js";

export const defaultOneClawMinimumAmount = "3000000";

export type OneClawGate = {
  required: boolean;
  linked: boolean;
  minimumAmount: string;
  executionAuthorized: boolean;
};

export function oneClawGate(input: {
  amountIn: string;
  linkedRoles: readonly FleetRole[];
  requiredRoles: readonly FleetRole[];
  minimumAmount?: string;
}): OneClawGate {
  const minimumAmount =
    input.minimumAmount ?? defaultOneClawMinimumAmount;
  const required = BigInt(input.amountIn) >= BigInt(minimumAmount);
  const linked = input.requiredRoles.every((role) =>
    input.linkedRoles.includes(role),
  );

  return {
    required,
    linked,
    minimumAmount,
    executionAuthorized: !required || linked,
  };
}
