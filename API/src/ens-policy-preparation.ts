import type { ApiConfig } from "./config.js";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import type { DurinWriter } from "./durin-writer.js";
import { ViemDurinWriter } from "./durin-writer.js";
import {
  agentSettingsSchema,
  hashEnsRecord,
  orchestrationManifestSchema,
} from "./ens-policy.js";
import type {
  EnsAgentSettings,
  EnsOrchestrationManifest,
} from "./ens-types.js";
import type { FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

export type EnsPolicyChange = {
  paused: boolean;
  allowedTickers: string[];
  maxAmountPerTrade: string;
  maxDeviationBps: number;
  minLiquidityUsd: number;
  maxOracleAgeSeconds: number;
};

export type EnsPolicyDiff = {
  field: string;
  before: boolean | number | string | string[];
  after: boolean | number | string | string[];
};

export type PreparedEnsPolicyChange = {
  rootName: string;
  currentManifestHash: `0x${string}`;
  manifestHash: `0x${string}`;
  manifest: EnsOrchestrationManifest;
  manifestJson: string;
  agentRecords: Record<
    FleetRole,
    {
      name: string;
      recordKey: "agent-context";
      settings: EnsAgentSettings;
      settingsJson: string;
      settingsHash: `0x${string}`;
    }
  >;
  diff: EnsPolicyDiff[];
  publicationMode: "prepared-only";
  requiredAuthorization: ["owner-wallet"];
};

type Dependencies = {
  controlPlane: Pick<EnsControlPlaneService, "resolve">;
  writer?: Pick<DurinWriter, "ready" | "setText">;
  now?: () => Date;
};

export class EnsPolicyPreparationService {
  private readonly now: () => Date;
  private readonly writer: Pick<DurinWriter, "ready" | "setText">;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.writer = dependencies.writer ?? new ViemDurinWriter(config);
  }

  async prepare(input: {
    userId: string;
    owner: EvmAddress;
    change: EnsPolicyChange;
  }): Promise<PreparedEnsPolicyChange> {
    const current = await this.dependencies.controlPlane.resolve({
      userId: input.userId,
      owner: input.owner,
    });
    if (
      current.status !== "active" ||
      !current.rootName ||
      !current.manifest ||
      !current.manifestHash ||
      !current.agentSettings
    ) {
      throw new Error(
        current.error ?? "The ENS fleet policy is not active",
      );
    }
    if (current.manifest.version >= Number.MAX_SAFE_INTEGER) {
      throw new Error("The ENS policy version cannot be incremented");
    }

    const diff = policyDiff(current.manifest, input.change);
    if (diff.length === 0) {
      throw new Error("The ENS policy change has no behavioral effect");
    }

    const version = current.manifest.version + 1;
    const agentRecords = {} as PreparedEnsPolicyChange["agentRecords"];
    for (const { role } of fleetRoles) {
      const existing = current.agentSettings[role];
      if (!existing) {
        throw new Error(`The ${role} ENS settings are unavailable`);
      }
      const settings = agentSettingsSchema.parse({
        ...existing,
        version,
      }) as EnsAgentSettings;
      const settingsJson = stableJson(settings);
      agentRecords[role] = {
        name: settings.ensName,
        recordKey: "agent-context",
        settings,
        settingsJson,
        settingsHash: hashEnsRecord(settingsJson),
      };
    }

    const updatedAt = this.now();
    const { paused, ...policy } = input.change;
    const manifest = orchestrationManifestSchema.parse({
      ...current.manifest,
      version,
      updatedAt: updatedAt.toISOString(),
      expiresAt: new Date(
        updatedAt.getTime() +
          this.config.ENS_POLICY_TTL_SECONDS * 1_000,
      ).toISOString(),
      paused,
      agentSettings: Object.fromEntries(
        fleetRoles.map(({ role }) => [
          role,
          {
            name: agentRecords[role].name,
            recordKey: "agent-context",
            hash: agentRecords[role].settingsHash,
          },
        ]),
      ),
      policy,
    }) as EnsOrchestrationManifest;
    const manifestJson = stableJson(manifest);

    return {
      rootName: current.rootName,
      currentManifestHash: current.manifestHash,
      manifestHash: hashEnsRecord(manifestJson),
      manifest,
      manifestJson,
      agentRecords,
      diff,
      publicationMode: "prepared-only",
      requiredAuthorization: ["owner-wallet"],
    };
  }

  async publish(input: {
    userId: string;
    owner: EvmAddress;
    change: EnsPolicyChange;
  }): Promise<
    PreparedEnsPolicyChange & {
      transactions: `0x${string}`[];
      verified: true;
    }
  > {
    if (!this.writer.ready()) {
      throw new Error("ENS policy publisher is not configured");
    }
    const prepared = await this.prepare(input);
    const transactions: `0x${string}`[] = [];
    for (const { role } of fleetRoles) {
      const record = prepared.agentRecords[role];
      transactions.push(
        await this.writer.setText(
          record.name,
          record.recordKey,
          record.settingsJson,
        ),
      );
    }
    transactions.push(
      await this.writer.setText(
        prepared.rootName,
        "agent-context",
        prepared.manifestJson,
      ),
    );
    const verified = await this.dependencies.controlPlane.resolve({
      userId: input.userId,
      owner: input.owner,
    });
    if (
      verified.status !== "active" ||
      verified.manifestHash?.toLowerCase() !==
        prepared.manifestHash.toLowerCase()
    ) {
      throw new Error("Published ENS policy did not verify");
    }
    return { ...prepared, transactions, verified: true };
  }
}

function policyDiff(
  current: EnsOrchestrationManifest,
  change: EnsPolicyChange,
): EnsPolicyDiff[] {
  const fields: Array<{
    field: string;
    before: EnsPolicyDiff["before"];
    after: EnsPolicyDiff["after"];
  }> = [
    { field: "paused", before: current.paused, after: change.paused },
    {
      field: "allowedTickers",
      before: current.policy.allowedTickers,
      after: change.allowedTickers,
    },
    {
      field: "maxAmountPerTrade",
      before: current.policy.maxAmountPerTrade,
      after: change.maxAmountPerTrade,
    },
    {
      field: "maxDeviationBps",
      before: current.policy.maxDeviationBps,
      after: change.maxDeviationBps,
    },
    {
      field: "minLiquidityUsd",
      before: current.policy.minLiquidityUsd,
      after: change.minLiquidityUsd,
    },
    {
      field: "maxOracleAgeSeconds",
      before: current.policy.maxOracleAgeSeconds,
      after: change.maxOracleAgeSeconds,
    },
  ];
  return fields.filter(
    ({ before, after }) => stableJson(before) !== stableJson(after),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
