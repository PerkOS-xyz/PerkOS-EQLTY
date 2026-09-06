export type ConsultationFact = {
  source: "ens" | "the-graph" | "onchain" | "uniswap";
  label: string;
  value: string;
};

export type ConsultationStep = {
  role: FleetRole;
  agentId?: string;
  agentName?: string;
  status: "verified" | "invalid" | "unavailable" | "skipped";
  ticker?: string;
  summary?: string;
  responseHash?: `0x${string}`;
  facts: ConsultationFact[];
  detail?: string;
};

export type AgentConsultation = {
  mode: "hermes-a2a" | "deterministic-fallback";
  status: "verified" | "invalid" | "unavailable";
  selectedTicker?: string;
  scout: ConsultationStep;
  risk: ConsultationStep;
  trader: ConsultationStep;
  auditor: ConsultationStep;
};
import type { FleetRole } from "./fleet-types.js";
