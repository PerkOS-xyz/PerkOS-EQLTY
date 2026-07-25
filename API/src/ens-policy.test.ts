import { describe, expect, it } from "vitest";
import { fleetNames, normalizeFleetLabel } from "./ens-names.js";
import {
  ENS_AGENT_SETTINGS_SCHEMA,
  ENS_ORCHESTRATION_SCHEMA,
  hashEnsRecord,
  parseAgentSettings,
  parseManifest,
} from "./ens-policy.js";
import type { FleetRole } from "./fleet-types.js";

const now = new Date("2026-07-25T12:00:00.000Z");
const rootName = "u-12345678.demo.eth";

describe("ENS policy validation", () => {
  it("builds one owner name and four agent subnames", () => {
    expect(fleetNames("u-12345678", "demo.eth")).toEqual({
      user: rootName,
      agents: {
        scout: `scout.${rootName}`,
        risk: `risk.${rootName}`,
        trader: `trader.${rootName}`,
        auditor: `auditor.${rootName}`,
      },
    });
    expect(() => normalizeFleetLabel("invalid label")).toThrow();
  });

  it("accepts a bounded manifest for Robinhood Chain", () => {
    const fixture = records();

    const manifest = parseManifest(
      fixture.manifest,
      rootName,
      4663,
      604_800,
      now,
    );

    expect(manifest.policy.allowedTickers).toEqual(["AMZN", "NVDA"]);
    expect(manifest.fleet.trader).toBe(`trader.${rootName}`);
  });

  it("rejects the wrong execution network", () => {
    const fixture = records();

    expect(() =>
      parseManifest(fixture.manifest, rootName, 46630, 604_800, now),
    ).toThrow("expected eip155:46630");
  });

  it("rejects expired or excessive policy lifetimes", () => {
    const fixture = records();
    const parsed = JSON.parse(fixture.manifest);

    expect(() =>
      parseManifest(
        JSON.stringify({
          ...parsed,
          expiresAt: "2026-07-25T11:59:59.000Z",
        }),
        rootName,
        4663,
        604_800,
        now,
      ),
    ).toThrow("expired");

    expect(() =>
      parseManifest(fixture.manifest, rootName, 4663, 60, now),
    ).toThrow("lifetime exceeds");
  });

  it("binds settings to their role and subname", () => {
    const fixture = records();

    expect(
      parseAgentSettings(
        fixture.settings.scout,
        "scout",
        `scout.${rootName}`,
      ),
    ).toMatchObject({
      role: "scout",
      perkosAgentId: "agent-scout",
    });
    expect(() =>
      parseAgentSettings(
        fixture.settings.scout,
        "trader",
        `trader.${rootName}`,
      ),
    ).toThrow("role must be trader");
  });

  it("produces a stable content hash", () => {
    const value = records().settings.auditor;

    expect(hashEnsRecord(value)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashEnsRecord(value)).toBe(hashEnsRecord(value));
  });
});

function records() {
  const roles: FleetRole[] = ["scout", "risk", "trader", "auditor"];
  const settings = Object.fromEntries(
    roles.map((role) => [
      role,
      JSON.stringify({
        schema: ENS_AGENT_SETTINGS_SCHEMA,
        version: 1,
        role,
        perkosAgentId: `agent-${role}`,
        ensName: `${role}.${rootName}`,
        behavior: {
          objective: `${role} objective`,
          inputs: ["ens", "the-graph-substreams"],
          actions: [action(role)],
          requiresWorldSelfieForChanges: true,
        },
        security: {
          provider: "1claw",
          enforcement: "required-before-spend",
          policyRef: `perkos:agent-${role}:1claw`,
        },
      }),
    ]),
  ) as Record<FleetRole, string>;
  const manifest = JSON.stringify({
    schema: ENS_ORCHESTRATION_SCHEMA,
    version: 1,
    network: "eip155:4663",
    updatedAt: now.toISOString(),
    expiresAt: "2026-07-26T12:00:00.000Z",
    paused: false,
    fleet: Object.fromEntries(
      roles.map((role) => [role, `${role}.${rootName}`]),
    ),
    agentSettings: Object.fromEntries(
      roles.map((role) => [
        role,
        {
          name: `${role}.${rootName}`,
          recordKey: "agent-context",
          hash: hashEnsRecord(settings[role]),
        },
      ]),
    ),
    policy: {
      allowedTickers: ["AMZN", "NVDA"],
      maxAmountPerTrade: "1000000",
      maxDeviationBps: 100,
      minLiquidityUsd: 50_000,
      maxOracleAgeSeconds: 300,
    },
  });
  return { manifest, settings };
}

function action(role: FleetRole) {
  return {
    scout: "recommend",
    risk: "risk-gate",
    trader: "swap-uniswap",
    auditor: "audit",
  }[role];
}
