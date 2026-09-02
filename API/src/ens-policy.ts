import { keccak256, stringToHex } from "viem";
import { normalize } from "viem/ens";
import { z } from "zod";
import type {
  EnsAgentRecordKey,
  EnsAgentSettings,
  EnsOrchestrationManifest,
} from "./ens-types.js";
import type { FleetRole } from "./fleet-types.js";

export const ENS_ORCHESTRATION_SCHEMA =
  "urn:eqlty:ens-orchestration:v1";
export const ENS_AGENT_SETTINGS_SCHEMA =
  "urn:eqlty:agent-settings:v1";

const uintString = z.string().max(78).regex(/^(0|[1-9]\d*)$/);
const ensName = z
  .string()
  .min(3)
  .max(255)
  .transform((value) => normalize(value));
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const agentRecordKey = z
  .string()
  .max(80)
  .regex(/^agent-context(?:-v[1-9]\d*-[0-9a-f]{8})?$/);
const role = z.enum(["scout", "risk", "trader", "auditor"]);
const roleNames = z
  .object({
    scout: ensName,
    risk: ensName,
    trader: ensName,
    auditor: ensName,
  })
  .strict();
const settingReferences = z
  .object({
    scout: settingReference(),
    risk: settingReference(),
    trader: settingReference(),
    auditor: settingReference(),
  })
  .strict();

export const agentSettingsSchema = z
  .object({
    schema: z.literal(ENS_AGENT_SETTINGS_SCHEMA),
    version: z.number().int().positive(),
    role,
    perkosAgentId: z.string().min(1).max(256),
    ensName,
    behavior: z
      .object({
        objective: z.string().min(1).max(512),
        inputs: z
          .array(
            z.enum([
              "ens",
              "robinhood-price-api",
              "chainlink-data-streams",
              "the-graph-substreams",
              "x401",
              "x402",
            ]),
          )
          .max(8),
        actions: z
          .array(
            z.enum([
              "recommend",
              "risk-gate",
              "swap-uniswap",
              "audit",
            ]),
          )
          .min(1)
          .max(4),
      })
      .strip(),
    security: z
      .object({
        provider: z.literal("1claw"),
        enforcement: z.literal("required-before-spend"),
        policyRef: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict();

export const orchestrationManifestSchema = z
  .object({
    schema: z.literal(ENS_ORCHESTRATION_SCHEMA),
    version: z.number().int().positive(),
    network: z.string().regex(/^eip155:\d+$/),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    paused: z.boolean(),
    fleet: roleNames,
    agentSettings: settingReferences.optional(),
    policy: z
      .object({
        allowedTickers: z
          .array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/))
          .min(1)
          .max(96),
        maxAmountPerTrade: uintString,
        maxDeviationBps: z.number().int().min(1).max(2_000),
        minLiquidityUsd: z
          .number()
          .finite()
          .min(0)
          .max(1_000_000_000_000),
        maxOracleAgeSeconds: z.number().int().min(1).max(86_400),
      })
      .strict(),
  })
  .strict();

export function parseManifest(
  raw: string,
  rootName: string,
  expectedChainId: number,
  maxTtlSeconds: number,
  now = new Date(),
  allowExpired = false,
): EnsOrchestrationManifest {
  const manifest = orchestrationManifestSchema.parse(parseJson(raw));
  if (manifest.network !== `eip155:${expectedChainId}`) {
    throw new Error(
      `ENS manifest targets ${manifest.network}, expected eip155:${expectedChainId}`,
    );
  }

  const normalizedRoot = normalize(rootName);
  for (const [agentRole, name] of Object.entries(manifest.fleet)) {
    if (name !== `${agentRole}.${normalizedRoot}`) {
      throw new Error(
        `ENS fleet.${agentRole} must equal ${agentRole}.${normalizedRoot}`,
      );
    }
  }
  if (manifest.agentSettings) {
    for (const [agentRole, reference] of Object.entries(
      manifest.agentSettings,
    )) {
      if (
        reference.name !==
        manifest.fleet[agentRole as FleetRole]
      ) {
        throw new Error(
          `ENS agentSettings.${agentRole}.name must match fleet.${agentRole}`,
        );
      }
    }
  }

  const updatedAt = Date.parse(manifest.updatedAt);
  const expiresAt = Date.parse(manifest.expiresAt);
  if (updatedAt > now.getTime() + 300_000) {
    throw new Error("ENS manifest updatedAt is in the future");
  }
  if (!allowExpired && expiresAt <= now.getTime()) {
    throw new Error("ENS manifest has expired");
  }
  if (expiresAt - updatedAt > maxTtlSeconds * 1_000) {
    throw new Error(
      `ENS manifest lifetime exceeds ${maxTtlSeconds} seconds`,
    );
  }
  return manifest as EnsOrchestrationManifest;
}

export function parseAgentSettings(
  raw: string,
  expectedRole: FleetRole,
  expectedName: string,
): EnsAgentSettings {
  const settings = agentSettingsSchema.parse(parseJson(raw));
  if (settings.role !== expectedRole) {
    throw new Error(`ENS agent settings role must be ${expectedRole}`);
  }
  if (settings.ensName !== normalize(expectedName)) {
    throw new Error(
      `ENS ${expectedRole} settings name does not match its fleet name`,
    );
  }
  return settings as EnsAgentSettings;
}

export function hashEnsRecord(raw: string): `0x${string}` {
  return keccak256(stringToHex(raw));
}

export function versionedAgentRecordKey(
  version: number,
  settingsHash: `0x${string}`,
): EnsAgentRecordKey {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("ENS agent settings version must be positive");
  }
  return `agent-context-v${version}-${settingsHash.slice(2, 10).toLowerCase()}`;
}

function settingReference() {
  return z
    .object({
      name: ensName,
      recordKey: agentRecordKey,
      hash: bytes32,
    })
    .strict();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("ENS agent-context is not valid JSON");
  }
}
