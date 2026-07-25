import type { FleetRole } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

export type EnsFleetNames = {
  user: string;
  agents: Record<FleetRole, string>;
};

export type EnsAgentSettings = {
  schema: "urn:eqlty:agent-settings:v1";
  version: number;
  role: FleetRole;
  perkosAgentId: string;
  ensName: string;
  behavior: {
    objective: string;
    inputs: Array<
      | "ens"
      | "robinhood-price-api"
      | "chainlink-data-streams"
      | "the-graph-substreams"
      | "x401"
      | "x402"
    >;
    actions: Array<
      "recommend" | "risk-gate" | "swap-uniswap" | "audit"
    >;
    requiresWorldSelfieForChanges: true;
  };
  security: {
    provider: "1claw";
    enforcement: "required-before-spend";
    policyRef: string;
  };
};

export type EnsOrchestrationManifest = {
  schema: "urn:eqlty:ens-orchestration:v1";
  version: number;
  network: string;
  updatedAt: string;
  expiresAt: string;
  paused: boolean;
  fleet: Record<FleetRole, string>;
  agentSettings?: Record<
    FleetRole,
    {
      name: string;
      recordKey: "agent-context";
      hash: `0x${string}`;
    }
  >;
  policy: {
    allowedTickers: string[];
    maxAmountPerTrade: string;
    maxDeviationBps: number;
    minLiquidityUsd: number;
    maxOracleAgeSeconds: number;
  };
};

export type EnsControlPlane = {
  source: "durin";
  mode: "live";
  status: "active" | "invalid" | "unavailable";
  rootName?: string;
  manifestHash?: `0x${string}`;
  resolvedAt: string;
  owner?: EvmAddress;
  manifest?: EnsOrchestrationManifest;
  agentSettings?: Partial<Record<FleetRole, EnsAgentSettings>>;
  error?: string;
};
