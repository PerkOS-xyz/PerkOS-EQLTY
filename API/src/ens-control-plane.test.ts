import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { DurinReader } from "./durin-reader.js";
import { EnsControlPlaneService } from "./ens-control-plane.js";
import {
  ENS_AGENT_SETTINGS_SCHEMA,
  ENS_ORCHESTRATION_SCHEMA,
  hashEnsRecord,
} from "./ens-policy.js";
import type { FleetRole } from "./fleet-types.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678" as const;
const root = "u-12345678.demo.eth";
const now = new Date("2026-07-25T12:00:00.000Z");
const roles: FleetRole[] = ["scout", "risk", "trader", "auditor"];

describe("ENS control plane", () => {
  it("resolves a complete hash-bound fleet", async () => {
    const service = new EnsControlPlaneService(config(), {
      reader: fixtureReader(),
      now: () => now,
    });

    const control = await service.resolve({
      userId: "u-12345678",
      owner,
    });

    expect(control).toMatchObject({
      source: "durin",
      mode: "live",
      status: "active",
      rootName: root,
      owner,
    });
    expect(control.manifest?.policy.allowedTickers).toEqual(["AMZN"]);
    expect(control.agentSettings?.trader).toMatchObject({
      role: "trader",
      perkosAgentId: "agent-trader",
    });
  });

  it("fails closed when an agent record is modified", async () => {
    const reader = fixtureReader();
    const originalText = reader.text;
    reader.text = async (name, key) =>
      name === `scout.${root}`
        ? `${await originalText(name, key)} `
        : originalText(name, key);
    const service = new EnsControlPlaneService(config(), {
      reader,
      now: () => now,
    });

    const control = await service.resolve({
      userId: "u-12345678",
      owner,
    });

    expect(control.status).toBe("invalid");
    expect(control.error).toContain("scout settings hash does not match");
    expect(control.agentSettings).toBeUndefined();
  });

  it("rejects a fleet owned by another wallet", async () => {
    const reader = fixtureReader();
    const originalOwner = reader.owner;
    reader.owner = async (name) =>
      name === root
        ? "0x9999999999999999999999999999999999999999"
        : originalOwner(name);
    const service = new EnsControlPlaneService(config(), {
      reader,
      now: () => now,
    });

    const control = await service.resolve({
      userId: "u-12345678",
      owner,
    });

    expect(control.status).toBe("invalid");
    expect(control.error).toContain("owned by another wallet");
  });

  it("reports unavailable configuration without reading the chain", async () => {
    const service = new EnsControlPlaneService(loadConfig({}), {
      reader: {
        ready: () => false,
        owner: async () => owner,
        address: async () => owner,
        text: async () => "",
      },
      now: () => now,
    });

    const control = await service.resolve({
      userId: "u-12345678",
      owner,
    });

    expect(control.status).toBe("unavailable");
    expect(control.error).toContain("not configured");
  });

  it("can verify an expired manifest only for a controlled renewal", async () => {
    const service = new EnsControlPlaneService(config(), {
      reader: fixtureReader(),
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });

    const blocked = await service.resolve({
      userId: "u-12345678",
      owner,
    });
    const renewable = await service.resolve({
      userId: "u-12345678",
      owner,
      allowExpired: true,
    });

    expect(blocked).toMatchObject({
      status: "invalid",
      error: "ENS manifest has expired",
    });
    expect(renewable).toMatchObject({
      status: "active",
      rootName: root,
      owner,
    });
  });
});

function config() {
  return loadConfig({
    ENS_ROOT_NAME: "demo.eth",
    EQLTY_ENS_RECORDS_RPC_URL: "https://base-sepolia.example",
    EQLTY_ENS_L2_REGISTRY_ADDRESS:
      "0x1111111111111111111111111111111111111111",
  });
}

function fixtureReader(): DurinReader {
  const settings = Object.fromEntries(
    roles.map((role) => [role, agentSettings(role)]),
  ) as Record<FleetRole, string>;
  const manifest = JSON.stringify({
    schema: ENS_ORCHESTRATION_SCHEMA,
    version: 1,
    network: "eip155:4663",
    updatedAt: now.toISOString(),
    expiresAt: "2026-07-26T12:00:00.000Z",
    paused: false,
    fleet: Object.fromEntries(
      roles.map((role) => [role, `${role}.${root}`]),
    ),
    agentSettings: Object.fromEntries(
      roles.map((role) => [
        role,
        {
          name: `${role}.${root}`,
          recordKey: `agent-context-v1-${hashEnsRecord(settings[role]).slice(2, 10)}`,
          hash: hashEnsRecord(settings[role]),
        },
      ]),
    ),
    policy: {
      allowedTickers: ["AMZN"],
      maxAmountPerTrade: "1000000",
      maxDeviationBps: 100,
      minLiquidityUsd: 50_000,
      maxOracleAgeSeconds: 300,
    },
  });
  return {
    ready: () => true,
    owner: async () => owner,
    address: async () => owner,
    text: async (name, key) => {
      if (name === root) {
        return key === "agent-context" ? manifest : "";
      }
      const role = name.split(".")[0] as FleetRole;
      const value = settings[role];
      const expectedKey = value
        ? `agent-context-v1-${hashEnsRecord(value).slice(2, 10)}`
        : "";
      return key === expectedKey ? value : "";
    },
  };
}

function agentSettings(role: FleetRole): string {
  const action = {
    scout: "recommend",
    risk: "risk-gate",
    trader: "swap-uniswap",
    auditor: "audit",
  }[role];
  return JSON.stringify({
    schema: ENS_AGENT_SETTINGS_SCHEMA,
    version: 1,
    role,
    perkosAgentId: `agent-${role}`,
    ensName: `${role}.${root}`,
    behavior: {
      objective: `${role} objective`,
      inputs: ["ens", "the-graph-substreams"],
      actions: [action],
    },
    security: {
      provider: "1claw",
      enforcement: "required-before-spend",
      policyRef: `perkos:agent-${role}:1claw`,
    },
  });
}
