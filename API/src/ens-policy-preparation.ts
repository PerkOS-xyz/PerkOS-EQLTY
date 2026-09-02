import type { ApiConfig } from "./config.js";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import type { DurinReader } from "./durin-reader.js";
import { ViemDurinReader } from "./durin-reader.js";
import type { DurinWriter } from "./durin-writer.js";
import { ViemDurinWriter } from "./durin-writer.js";
import {
  agentSettingsSchema,
  hashEnsRecord,
  orchestrationManifestSchema,
  versionedAgentRecordKey,
} from "./ens-policy.js";
import type {
  EnsAgentRecordKey,
  EnsAgentSettings,
  EnsControlPlane,
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
      recordKey: EnsAgentRecordKey;
      settings: EnsAgentSettings;
      settingsJson: string;
      settingsHash: `0x${string}`;
    }
  >;
  diff: EnsPolicyDiff[];
  publicationMode: "prepared-only";
  requiredAuthorization: ["owner-wallet"];
};

export type PublishedEnsPolicyChange = PreparedEnsPolicyChange & {
  transactions: `0x${string}`[];
  verified: true;
};

type Dependencies = {
  controlPlane: Pick<EnsControlPlaneService, "resolve">;
  reader?: Pick<DurinReader, "ready" | "text">;
  writer?: Pick<DurinWriter, "ready" | "setText"> &
    Partial<Pick<DurinWriter, "registrar">>;
  now?: () => Date;
  settlementPollMs?: number;
  settlementPollAttempts?: number;
};

const publicationQueues = new Map<string, Promise<unknown>>();

export class EnsPolicyPreparationService {
  private readonly now: () => Date;
  private readonly reader: Pick<DurinReader, "ready" | "text">;
  private readonly writer: Pick<DurinWriter, "ready" | "setText"> &
    Partial<Pick<DurinWriter, "registrar">>;
  private readonly settlementPollMs: number;
  private readonly settlementPollAttempts: number;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.reader = dependencies.reader ?? new ViemDurinReader(config);
    this.writer = dependencies.writer ?? new ViemDurinWriter(config);
    this.settlementPollMs = dependencies.settlementPollMs ?? 750;
    this.settlementPollAttempts =
      dependencies.settlementPollAttempts ?? 20;
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
    return this.build(current, input.change);
  }

  async publish(input: {
    userId: string;
    owner: EvmAddress;
    change: EnsPolicyChange;
  }): Promise<PublishedEnsPolicyChange> {
    this.assertPublicationReady();
    const prepared = await this.prepare(input);
    return this.publishPrepared(input, prepared);
  }

  async renew(input: {
    userId: string;
    owner: EvmAddress;
  }): Promise<PublishedEnsPolicyChange> {
    this.assertPublicationReady();
    const current = await this.dependencies.controlPlane.resolve({
      ...input,
      allowExpired: true,
    });
    if (
      current.status !== "active" ||
      !current.manifest ||
      Date.parse(current.manifest.expiresAt) > this.now().getTime()
    ) {
      throw new Error(
        current.error ?? "The ENS fleet policy does not require renewal",
      );
    }
    const prepared = this.build(
      current,
      {
        paused: current.manifest.paused,
        ...current.manifest.policy,
      },
      true,
    );
    return this.publishPrepared(input, prepared);
  }

  private build(
    current: EnsControlPlane,
    change: EnsPolicyChange,
    allowNoop = false,
  ): PreparedEnsPolicyChange {
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

    const diff = policyDiff(current.manifest, change);
    if (!allowNoop && diff.length === 0) {
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
      const settingsHash = hashEnsRecord(settingsJson);
      agentRecords[role] = {
        name: settings.ensName,
        recordKey: versionedAgentRecordKey(version, settingsHash),
        settings,
        settingsJson,
        settingsHash,
      };
    }

    const updatedAt = this.now();
    const { paused, ...policy } = change;
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
            recordKey: agentRecords[role].recordKey,
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

  private async publishPrepared(
    input: { userId: string; owner: EvmAddress },
    prepared: PreparedEnsPolicyChange,
  ): Promise<PublishedEnsPolicyChange> {
    const queueKey = this.writerKey();
    const previous = publicationQueues.get(queueKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.publishPreparedSerial(input, prepared));
    publicationQueues.set(queueKey, current);
    try {
      return await current;
    } finally {
      if (publicationQueues.get(queueKey) === current) {
        publicationQueues.delete(queueKey);
      }
    }
  }

  private async publishPreparedSerial(
    input: { userId: string; owner: EvmAddress },
    prepared: PreparedEnsPolicyChange,
  ): Promise<PublishedEnsPolicyChange> {
    const transactions: `0x${string}`[] = [];
    for (const { role } of fleetRoles) {
      const record = prepared.agentRecords[role];
      const transaction = await this.writeRecord(
        record.name,
        record.recordKey,
        record.settingsJson,
        record.settingsHash,
      );
      if (transaction) transactions.push(transaction);
    }

    for (const { role } of fleetRoles) {
      const record = prepared.agentRecords[role];
      const staged = await this.reader.text(
        record.name,
        record.recordKey,
      );
      if (
        !staged ||
        hashEnsRecord(staged).toLowerCase() !==
          record.settingsHash.toLowerCase()
      ) {
        throw new Error(
          `Staged ENS ${role} settings did not verify`,
        );
      }
    }

    const currentManifest = await this.reader.text(
      prepared.rootName,
      "agent-context",
    );
    if (
      !currentManifest ||
      hashEnsRecord(currentManifest).toLowerCase() !==
        prepared.currentManifestHash.toLowerCase()
    ) {
      throw new Error(
        "ENS policy changed while this update was being staged",
      );
    }

    const manifestTransaction = await this.writeRecord(
      prepared.rootName,
      "agent-context",
      prepared.manifestJson,
      prepared.manifestHash,
    );
    if (manifestTransaction) transactions.push(manifestTransaction);
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

  private async writeRecord(
    name: string,
    key: string,
    value: string,
    expectedHash: `0x${string}`,
  ): Promise<`0x${string}` | undefined> {
    if (await this.recordMatches(name, key, expectedHash)) {
      return undefined;
    }
    try {
      return await this.writer.setText(name, key, value);
    } catch (error) {
      if (
        !pendingTransactionError(error) ||
        !(await this.waitForRecord(name, key, expectedHash))
      ) {
        throw error;
      }
      return undefined;
    }
  }

  private async waitForRecord(
    name: string,
    key: string,
    expectedHash: `0x${string}`,
  ): Promise<boolean> {
    for (
      let attempt = 0;
      attempt < this.settlementPollAttempts;
      attempt += 1
    ) {
      if (await this.recordMatches(name, key, expectedHash)) {
        return true;
      }
      if (this.settlementPollMs > 0) {
        await wait(this.settlementPollMs);
      }
    }
    return false;
  }

  private async recordMatches(
    name: string,
    key: string,
    expectedHash: `0x${string}`,
  ): Promise<boolean> {
    const current = await this.reader.text(name, key);
    return Boolean(
      current &&
        hashEnsRecord(current).toLowerCase() ===
          expectedHash.toLowerCase(),
    );
  }

  private writerKey(): string {
    return (
      this.writer.registrar?.()?.toLowerCase() ?? "eqlty-ens-writer"
    );
  }

  private assertPublicationReady(): void {
    if (!this.writer.ready()) {
      throw new Error("ENS policy publisher is not configured");
    }
    if (!this.reader.ready()) {
      throw new Error("ENS policy verifier is not configured");
    }
  }
}

function pendingTransactionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /replacement transaction underpriced|already known|nonce too low|nonce has already been used/i.test(
      error.message,
    )
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
