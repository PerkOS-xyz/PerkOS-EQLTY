import type { ApiConfig } from "./config.js";
import { fleetNames } from "./ens-names.js";
import {
  agentSettingsSchema,
  hashEnsRecord,
  orchestrationManifestSchema,
} from "./ens-policy.js";
import type {
  EnsAgentSettings,
  EnsFleetNames,
  EnsOrchestrationManifest,
} from "./ens-types.js";
import type { FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";

type AgentIds = Record<FleetRole, string>;

export type EnsFleetBundle = {
  names: EnsFleetNames;
  manifest: EnsOrchestrationManifest;
  manifestJson: string;
  manifestHash: `0x${string}`;
  agents: Record<
    FleetRole,
    {
      settings: EnsAgentSettings;
      settingsJson: string;
      settingsHash: `0x${string}`;
    }
  >;
};

export function buildEnsFleetBundle(
  config: ApiConfig,
  input: {
    userId: string;
    agentIds: AgentIds;
    now?: Date;
  },
): EnsFleetBundle {
  if (!config.ENS_ROOT_NAME) {
    throw new Error("ENS root name is not configured");
  }
  const now = input.now ?? new Date();
  const names = fleetNames(input.userId, config.ENS_ROOT_NAME);
  const agents = {} as EnsFleetBundle["agents"];

  for (const { role } of fleetRoles) {
    const settings = agentSettingsSchema.parse({
      schema: "urn:eqlty:agent-settings:v1",
      version: config.ENS_POLICY_VERSION,
      role,
      perkosAgentId: input.agentIds[role],
      ensName: names.agents[role],
      behavior: roleBehavior(role),
      security: {
        provider: "1claw",
        enforcement: "required-before-spend",
        policyRef: `perkos:${input.agentIds[role]}:1claw`,
      },
    }) as EnsAgentSettings;
    const settingsJson = stableJson(settings);
    agents[role] = {
      settings,
      settingsJson,
      settingsHash: hashEnsRecord(settingsJson),
    };
  }

  const manifest = orchestrationManifestSchema.parse({
    schema: "urn:eqlty:ens-orchestration:v1",
    version: config.ENS_POLICY_VERSION,
    network: `eip155:${config.ROBINHOOD_CHAIN_ID}`,
    updatedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + config.ENS_POLICY_TTL_SECONDS * 1_000,
    ).toISOString(),
    paused: config.ENS_POLICY_PAUSED,
    fleet: names.agents,
    agentSettings: Object.fromEntries(
      fleetRoles.map(({ role }) => [
        role,
        {
          name: names.agents[role],
          recordKey: "agent-context",
          hash: agents[role].settingsHash,
        },
      ]),
    ),
    policy: {
      allowedTickers: allowedTickers(config.ENS_POLICY_ALLOWED_TICKERS),
      maxAmountPerTrade: config.ENS_POLICY_MAX_AMOUNT_PER_TRADE,
      maxDeviationBps: config.ENS_POLICY_MAX_DEVIATION_BPS,
      minLiquidityUsd: config.ENS_POLICY_MIN_LIQUIDITY_USD,
      maxOracleAgeSeconds: config.ENS_POLICY_MAX_ORACLE_AGE_SECONDS,
    },
  }) as EnsOrchestrationManifest;
  const manifestJson = stableJson(manifest);

  return {
    names,
    manifest,
    manifestJson,
    manifestHash: hashEnsRecord(manifestJson),
    agents,
  };
}

function roleBehavior(
  role: FleetRole,
): EnsAgentSettings["behavior"] {
  const behavior: Record<FleetRole, EnsAgentSettings["behavior"]> = {
    scout: {
      objective:
        "Discover tradeable Robinhood stock tokens and collect market evidence.",
      inputs: [
        "ens",
        "robinhood-price-api",
        "the-graph-substreams",
        "x401",
      ],
      actions: ["recommend"],
    },
    risk: {
      objective:
        "Verify freshness, liquidity and owner policy before approving a candidate.",
      inputs: ["ens", "the-graph-substreams", "x401"],
      actions: ["risk-gate"],
    },
    trader: {
      objective:
        "Execute the approved stock-token route through Uniswap within every limit.",
      inputs: ["ens", "x401", "x402"],
      actions: ["swap-uniswap"],
    },
    auditor: {
      objective:
        "Reconcile policy, indexed evidence and the final transaction receipt.",
      inputs: ["ens", "the-graph-substreams", "x401", "x402"],
      actions: ["audit"],
    },
  };
  return behavior[role];
}

function allowedTickers(raw: string): string[] {
  const tickers = [
    ...new Set(
      raw
        .split(",")
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (tickers.length === 0) {
    throw new Error("ENS policy must allow at least one ticker");
  }
  return tickers;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
