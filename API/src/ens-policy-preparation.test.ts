import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildEnsFleetBundle } from "./ens-policy-builder.js";
import { EnsPolicyPreparationService } from "./ens-policy-preparation.js";
import { hashEnsRecord, parseManifest } from "./ens-policy.js";

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
      requiredAuthorization: ["owner-wallet", "world-selfie"],
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
