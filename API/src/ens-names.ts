import { normalize } from "viem/ens";
import type { EnsFleetNames } from "./ens-types.js";

export function normalizeFleetLabel(value: string): string {
  const normalized = normalize(value.trim().toLowerCase());
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(normalized)) {
    throw new Error(
      "user id must be 3-32 lowercase letters, numbers or internal hyphens",
    );
  }
  return normalized;
}

export function fleetNames(
  userId: string,
  rootName: string,
): EnsFleetNames {
  const label = normalizeFleetLabel(userId);
  const root = normalize(rootName);
  const user = `${label}.${root}`;
  return {
    user,
    agents: {
      scout: `scout.${user}`,
      risk: `risk.${user}`,
      trader: `trader.${user}`,
      auditor: `auditor.${user}`,
    },
  };
}
