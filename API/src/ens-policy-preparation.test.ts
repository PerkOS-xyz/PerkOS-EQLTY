import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildEnsFleetBundle } from "./ens-policy-builder.js";
import { EnsPolicyPreparationService } from "./ens-policy-preparation.js";
import { hashEnsRecord, parseManifest } from "./ens-policy.js";
import type { EnsAgentSettings } from "./ens-types.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678" as const;
const currentTime = new Date("2026-07-25T12:00:00.000Z");
const preparedTime = new Date("2026-07-25T12:30:00.000Z");
const agentIds = {
  scout: "agent-scout",
  risk: "agent-risk",
  trader: "agent-trader",
  auditor: "agent-auditor",
};

describe("ENS policy preparation", () => {
  it("prepares hash-bound manifest and role settings", async () => {
    const { config, bundle } = fixture();
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: bundle.names.user,
          manifestHash: bundle.manifestHash,
          resolvedAt: currentTime.toISOString(),
          owner,
          manifest: bundle.manifest,
          agentSettings: settingsFor(bundle),
        }),
      },
      now: () => preparedTime,
    });

    const prepared = await service.prepare({
      userId: "u-12345678",
      owner,
      change: {
        paused: false,
        allowedTickers: ["NVDA", "AMZN", "AMD", "PLTR"],
        maxAmountPerTrade: "2000000",
        maxDeviationBps: 400,
        minLiquidityUsd: 75_000,
        maxOracleAgeSeconds: 600,
      },
    });

    expect(prepared).toMatchObject({
      rootName: "u-12345678.demo.eth",
      currentManifestHash: bundle.manifestHash,
      publicationMode: "prepared-only",
      requiredAuthorization: ["owner-wallet"],
      manifest: {
        version: 2,
        updatedAt: "2026-07-25T12:30:00.000Z",
        expiresAt: "2026-07-25T13:30:00.000Z",
        policy: {
          maxAmountPerTrade: "2000000",
        },
      },
    });
    expect(prepared.diff.map(({ field }) => field)).toEqual([
      "allowedTickers",
      "maxAmountPerTrade",
      "maxDeviationBps",
      "minLiquidityUsd",
      "maxOracleAgeSeconds",
    ]);
    expect(prepared.manifestHash).toBe(
      hashEnsRecord(prepared.manifestJson),
    );

    for (const [role, record] of Object.entries(
      prepared.agentRecords,
    )) {
      expect(record.settings.version).toBe(2);
      expect(record.settingsHash).toBe(
        hashEnsRecord(record.settingsJson),
      );
      expect(
        prepared.manifest.agentSettings?.[
          role as keyof typeof prepared.agentRecords
        ].hash,
      ).toBe(record.settingsHash);
    }
    expect(
      parseManifest(
        prepared.manifestJson,
        prepared.rootName,
        4663,
        3_600,
        preparedTime,
      ),
    ).toEqual(prepared.manifest);
  });

  it("prepares an emergency stop as a single semantic diff", async () => {
    const { config, bundle } = fixture();
    const service = serviceFor(config, bundle);

    const prepared = await service.prepare({
      userId: "u-12345678",
      owner,
      change: {
        paused: true,
        ...bundle.manifest.policy,
      },
    });

    expect(prepared.manifest.paused).toBe(true);
    expect(prepared.diff).toEqual([
      { field: "paused", before: false, after: true },
    ]);
  });

  it("refreshes retired Chainlink capabilities on the next publication", async () => {
    const { config, bundle } = fixture();
    const legacyRisk = {
      ...bundle.agents.risk.settings,
      behavior: {
        objective: "Check Chainlink data before approving a candidate.",
        inputs: ["ens", "chainlink-data-streams", "the-graph-substreams"],
        actions: ["risk-gate"],
      },
    } as EnsAgentSettings;
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: bundle.names.user,
          manifestHash: bundle.manifestHash,
          resolvedAt: currentTime.toISOString(),
          owner,
          manifest: bundle.manifest,
          agentSettings: {
            ...settingsFor(bundle),
            risk: legacyRisk,
          },
        }),
      },
      now: () => preparedTime,
    });

    const prepared = await service.prepare({
      userId: "u-12345678",
      owner,
      change: {
        paused: true,
        ...bundle.manifest.policy,
      },
    });

    expect(prepared.agentRecords.risk.settings.behavior.inputs).toEqual([
      "ens",
      "the-graph-substreams",
      "x401",
    ]);
    expect(
      prepared.agentRecords.risk.settings.behavior.objective,
    ).not.toContain("Chainlink");
  });

  it("publishes role records before the manifest and verifies the result", async () => {
    const { config, bundle } = fixture();
    const writes: Array<{
      name: string;
      key: string;
      value: string;
    }> = [];
    let resolveCount = 0;
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => {
          resolveCount += 1;
          if (resolveCount === 1) {
            return {
              source: "durin",
              mode: "live",
              status: "active",
              rootName: bundle.names.user,
              manifestHash: bundle.manifestHash,
              resolvedAt: currentTime.toISOString(),
              owner,
              manifest: bundle.manifest,
              agentSettings: settingsFor(bundle),
            };
          }
          const manifestJson = writes.at(-1)?.value ?? "";
          return {
            source: "durin",
            mode: "live",
            status: "active",
            rootName: bundle.names.user,
            manifestHash: hashEnsRecord(manifestJson),
            resolvedAt: preparedTime.toISOString(),
            owner,
            manifest: JSON.parse(manifestJson),
            agentSettings: settingsFor(bundle),
          };
        },
      },
      writer: {
        ready: () => true,
        setText: async (name, key, value) => {
          writes.push({ name, key, value });
          return `0x${writes.length.toString(16).padStart(64, "0")}`;
        },
      },
      reader: {
        ready: () => true,
        text: async (name, key) => {
          const written = [...writes]
            .reverse()
            .find(
              (record) =>
                record.name === name && record.key === key,
            );
          if (written) return written.value;
          if (
            name === bundle.names.user &&
            key === "agent-context"
          ) {
            return bundle.manifestJson;
          }
          return "";
        },
      },
      now: () => preparedTime,
    });

    const published = await service.publish({
      userId: "u-12345678",
      owner,
      change: {
        paused: true,
        ...bundle.manifest.policy,
      },
    });

    expect(writes).toHaveLength(5);
    expect(writes.slice(0, 4).map(({ name }) => name)).toEqual([
      bundle.names.agents.scout,
      bundle.names.agents.risk,
      bundle.names.agents.trader,
      bundle.names.agents.auditor,
    ]);
    expect(writes.slice(0, 4).map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^agent-context-v2-[0-9a-f]{8}$/),
      ]),
    );
    expect(writes[4]).toMatchObject({
      name: bundle.names.user,
      key: "agent-context",
      value: published.manifestJson,
    });
    expect(published.transactions).toHaveLength(5);
    expect(published.verified).toBe(true);
  });

  it("reconciles a record that settles after a nonce collision", async () => {
    const { config, bundle } = fixture();
    const writes: Array<{
      name: string;
      key: string;
      value: string;
    }> = [];
    let pending:
      | { name: string; key: string; value: string }
      | undefined;
    let resolveCount = 0;
    let attempts = 0;
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => {
          resolveCount += 1;
          if (resolveCount === 1) {
            return {
              source: "durin",
              mode: "live",
              status: "active",
              rootName: bundle.names.user,
              manifestHash: bundle.manifestHash,
              resolvedAt: currentTime.toISOString(),
              owner,
              manifest: bundle.manifest,
              agentSettings: settingsFor(bundle),
            };
          }
          const manifestJson = writes.at(-1)?.value ?? "";
          return {
            source: "durin",
            mode: "live",
            status: "active",
            rootName: bundle.names.user,
            manifestHash: hashEnsRecord(manifestJson),
            resolvedAt: preparedTime.toISOString(),
            owner,
            manifest: JSON.parse(manifestJson),
            agentSettings: settingsFor(bundle),
          };
        },
      },
      writer: {
        ready: () => true,
        setText: async (name, key, value) => {
          attempts += 1;
          if (attempts === 1) {
            pending = { name, key, value };
            throw new Error("replacement transaction underpriced");
          }
          writes.push({ name, key, value });
          return `0x${attempts.toString(16).padStart(64, "0")}`;
        },
      },
      reader: {
        ready: () => true,
        text: async (name, key) => {
          const written = [...writes]
            .reverse()
            .find(
              (record) =>
                record.name === name && record.key === key,
            );
          if (written) return written.value;
          if (pending?.name === name && pending.key === key) {
            return pending.value;
          }
          return name === bundle.names.user && key === "agent-context"
            ? bundle.manifestJson
            : "";
        },
      },
      now: () => preparedTime,
      settlementPollAttempts: 1,
      settlementPollMs: 0,
    });

    const published = await service.publish({
      userId: "u-12345678",
      owner,
      change: { paused: true, ...bundle.manifest.policy },
    });

    expect(attempts).toBe(5);
    expect(writes).toHaveLength(4);
    expect(published.transactions).toHaveLength(4);
    expect(published.verified).toBe(true);
  });

  it("leaves the active manifest untouched when staging fails", async () => {
    const { config, bundle } = fixture();
    const writes: Array<{ name: string; key: string }> = [];
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: bundle.names.user,
          manifestHash: bundle.manifestHash,
          resolvedAt: currentTime.toISOString(),
          owner,
          manifest: bundle.manifest,
          agentSettings: settingsFor(bundle),
        }),
      },
      writer: {
        ready: () => true,
        setText: async (name, key) => {
          writes.push({ name, key });
          if (writes.length === 3) {
            throw new Error("simulated transaction failure");
          }
          return `0x${writes.length.toString(16).padStart(64, "0")}`;
        },
      },
      reader: {
        ready: () => true,
        text: async () => "",
      },
      now: () => preparedTime,
    });

    await expect(
      service.publish({
        userId: "u-12345678",
        owner,
        change: {
          paused: true,
          ...bundle.manifest.policy,
        },
      }),
    ).rejects.toThrow("simulated transaction failure");

    expect(
      writes.some(
        ({ name, key }) =>
          name === bundle.names.user && key === "agent-context",
      ),
    ).toBe(false);
    expect(
      writes.every(({ key }) =>
        key.startsWith("agent-context-v2-"),
      ),
    ).toBe(true);
  });

  it("renews an expired policy without changing its behavior", async () => {
    const { config, bundle } = fixture();
    const renewalTime = new Date("2026-07-25T14:00:00.000Z");
    const writes: Array<{ name: string; key: string; value: string }> = [];
    let resolveCount = 0;
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => {
          resolveCount += 1;
          if (resolveCount === 1) {
            return {
              source: "durin",
              mode: "live",
              status: "active",
              rootName: bundle.names.user,
              manifestHash: bundle.manifestHash,
              resolvedAt: renewalTime.toISOString(),
              owner,
              manifest: bundle.manifest,
              agentSettings: settingsFor(bundle),
            };
          }
          const manifestJson = writes.at(-1)?.value ?? "";
          return {
            source: "durin",
            mode: "live",
            status: "active",
            rootName: bundle.names.user,
            manifestHash: hashEnsRecord(manifestJson),
            resolvedAt: renewalTime.toISOString(),
            owner,
            manifest: JSON.parse(manifestJson),
            agentSettings: settingsFor(bundle),
          };
        },
      },
      writer: {
        ready: () => true,
        setText: async (name, key, value) => {
          writes.push({ name, key, value });
          return `0x${writes.length.toString(16).padStart(64, "0")}`;
        },
      },
      reader: {
        ready: () => true,
        text: async (name, key) => {
          const written = [...writes]
            .reverse()
            .find((record) => record.name === name && record.key === key);
          if (written) return written.value;
          return name === bundle.names.user && key === "agent-context"
            ? bundle.manifestJson
            : "";
        },
      },
      now: () => renewalTime,
    });

    const renewed = await service.renew({
      userId: "u-12345678",
      owner,
    });

    expect(renewed).toMatchObject({
      verified: true,
      diff: [],
      manifest: {
        version: 2,
        paused: bundle.manifest.paused,
        policy: bundle.manifest.policy,
        updatedAt: "2026-07-25T14:00:00.000Z",
        expiresAt: "2026-07-25T15:00:00.000Z",
      },
    });
    expect(renewed.transactions).toHaveLength(5);
  });

  it("does not commit over a concurrently changed manifest", async () => {
    const { config, bundle } = fixture();
    const writes: Array<{
      name: string;
      key: string;
      value: string;
    }> = [];
    const service = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: bundle.names.user,
          manifestHash: bundle.manifestHash,
          resolvedAt: currentTime.toISOString(),
          owner,
          manifest: bundle.manifest,
          agentSettings: settingsFor(bundle),
        }),
      },
      writer: {
        ready: () => true,
        setText: async (name, key, value) => {
          writes.push({ name, key, value });
          return `0x${writes.length.toString(16).padStart(64, "0")}`;
        },
      },
      reader: {
        ready: () => true,
        text: async (name, key) => {
          const written = [...writes]
            .reverse()
            .find(
              (record) =>
                record.name === name && record.key === key,
            );
          if (written) return written.value;
          if (
            name === bundle.names.user &&
            key === "agent-context"
          ) {
            return `${bundle.manifestJson} `;
          }
          return "";
        },
      },
      now: () => preparedTime,
    });

    await expect(
      service.publish({
        userId: "u-12345678",
        owner,
        change: {
          paused: true,
          ...bundle.manifest.policy,
        },
      }),
    ).rejects.toThrow(
      "ENS policy changed while this update was being staged",
    );

    expect(writes).toHaveLength(4);
    expect(
      writes.some(
        ({ name, key }) =>
          name === bundle.names.user && key === "agent-context",
      ),
    ).toBe(false);
  });

  it("rejects inactive control planes and no-op changes", async () => {
    const { config, bundle } = fixture();
    const unavailable = new EnsPolicyPreparationService(config, {
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "unavailable",
          resolvedAt: currentTime.toISOString(),
          error: "ENS records are unavailable",
        }),
      },
    });

    await expect(
      unavailable.prepare({
        userId: "u-12345678",
        owner,
        change: { paused: false, ...bundle.manifest.policy },
      }),
    ).rejects.toThrow("ENS records are unavailable");

    await expect(
      serviceFor(config, bundle).prepare({
        userId: "u-12345678",
        owner,
        change: { paused: false, ...bundle.manifest.policy },
      }),
    ).rejects.toThrow("no behavioral effect");
  });
});

function fixture() {
  const config = loadConfig({
    ENS_ROOT_NAME: "demo.eth",
    ENS_POLICY_ALLOWED_TICKERS: "NVDA,AMZN",
    ENS_POLICY_TTL_SECONDS: "3600",
  });
  return {
    config,
    bundle: buildEnsFleetBundle(config, {
      userId: "u-12345678",
      agentIds,
      now: currentTime,
    }),
  };
}

function serviceFor(
  config: ReturnType<typeof loadConfig>,
  bundle: ReturnType<typeof buildEnsFleetBundle>,
) {
  return new EnsPolicyPreparationService(config, {
    controlPlane: {
      resolve: async () => ({
        source: "durin",
        mode: "live",
        status: "active",
        rootName: bundle.names.user,
        manifestHash: bundle.manifestHash,
        resolvedAt: currentTime.toISOString(),
        owner,
        manifest: bundle.manifest,
        agentSettings: settingsFor(bundle),
      }),
    },
    now: () => preparedTime,
  });
}

function settingsFor(
  bundle: ReturnType<typeof buildEnsFleetBundle>,
) {
  return {
    scout: bundle.agents.scout.settings,
    risk: bundle.agents.risk.settings,
    trader: bundle.agents.trader.settings,
    auditor: bundle.agents.auditor.settings,
  };
}
