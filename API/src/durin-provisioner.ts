import { namehash } from "viem";
import type { ApiConfig } from "./config.js";
import type { DurinReader } from "./durin-reader.js";
import { ViemDurinReader } from "./durin-reader.js";
import type { DurinWriter } from "./durin-writer.js";
import { ViemDurinWriter } from "./durin-writer.js";
import {
  buildEnsFleetBundle,
  type EnsFleetBundle,
} from "./ens-policy-builder.js";
import { fleetNames } from "./ens-names.js";
import type { FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

const zeroAddress = "0x0000000000000000000000000000000000000000";

type Dependencies = {
  reader?: DurinReader;
  writer?: DurinWriter;
  now?: () => Date;
};

export type FleetProvisioning = {
  bundle: EnsFleetBundle;
  transactions: `0x${string}`[];
  created: string[];
  verified: true;
};

export class DurinFleetProvisioner {
  private readonly reader: DurinReader;
  private readonly writer: DurinWriter;
  private readonly now: () => Date;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.reader = dependencies.reader ?? new ViemDurinReader(config);
    this.writer = dependencies.writer ?? new ViemDurinWriter(config);
    this.now = dependencies.now ?? (() => new Date());
  }

  ready(): boolean {
    return this.reader.ready() && this.writer.ready();
  }

  async provision(input: {
    userId: string;
    owner: EvmAddress;
    agentIds: Record<FleetRole, string>;
  }): Promise<FleetProvisioning> {
    if (!this.ready() || !this.config.ENS_ROOT_NAME) {
      throw new Error("ENS registrar is not configured");
    }
    if (!(await this.writer.registrarApproved())) {
      throw new Error(
        `ENS registrar ${this.writer.registrar() ?? "unknown"} is not approved`,
      );
    }
    const expectedBaseNode = namehash(this.config.ENS_ROOT_NAME);
    if ((await this.writer.baseNode()) !== expectedBaseNode) {
      throw new Error("ENS registry base node does not match the root name");
    }

    const names = fleetNames(input.userId, this.config.ENS_ROOT_NAME);
    const addresses = Object.fromEntries(
      fleetRoles.map(({ role }) => {
        const address = roleAddress(this.config, role);
        if (!address) {
          throw new Error(`ENS ${role} address is not configured`);
        }
        return [role, address];
      }),
    ) as Record<FleetRole, EvmAddress>;
    const existingManifest = await this.existingText(names.user);
    const bundle = buildEnsFleetBundle(this.config, {
      userId: input.userId,
      agentIds: input.agentIds,
      now: issuedAt(existingManifest) ?? this.now(),
    });
    const transactions: `0x${string}`[] = [];
    const created: string[] = [];

    await this.ensureNode({
      name: names.user,
      parentNode: expectedBaseNode,
      label: names.user.slice(0, names.user.indexOf(".")),
      owner: input.owner,
      address: input.owner,
      text: bundle.manifestJson,
      transactions,
      created,
    });

    for (const { role } of fleetRoles) {
      await this.ensureNode({
        name: names.agents[role],
        parentNode: namehash(names.user),
        label: role,
        owner: input.owner,
        address: addresses[role],
        text: bundle.agents[role].settingsJson,
        transactions,
        created,
      });
    }

    await this.verify(bundle, input.owner, addresses);
    return { bundle, transactions, created, verified: true };
  }

  private async ensureNode(input: {
    name: string;
    parentNode: `0x${string}`;
    label: string;
    owner: EvmAddress;
    address: EvmAddress;
    text: string;
    transactions: `0x${string}`[];
    created: string[];
  }): Promise<void> {
    const owner = await this.reader.owner(input.name);
    if (sameAddress(owner, zeroAddress)) {
      input.transactions.push(await this.writer.createNode(input));
      input.created.push(input.name);
      return;
    }
    await this.assertRecords(input.name, input.owner, input.address, input.text);
  }

  private async verify(
    bundle: EnsFleetBundle,
    owner: EvmAddress,
    addresses: Record<FleetRole, EvmAddress>,
  ): Promise<void> {
    await this.assertRecords(
      bundle.names.user,
      owner,
      owner,
      bundle.manifestJson,
    );
    for (const { role } of fleetRoles) {
      await this.assertRecords(
        bundle.names.agents[role],
        owner,
        addresses[role],
        bundle.agents[role].settingsJson,
      );
    }
  }

  private async assertRecords(
    name: string,
    owner: EvmAddress,
    address: EvmAddress,
    text: string,
  ): Promise<void> {
    const [storedOwner, storedAddress, storedText] = await Promise.all([
      this.reader.owner(name),
      this.reader.address(name),
      this.reader.text(name, "agent-context"),
    ]);
    if (!sameAddress(storedOwner, owner)) {
      throw new Error(`ENS ${name} has an unexpected owner`);
    }
    if (!sameAddress(storedAddress, address)) {
      throw new Error(`ENS ${name} has an unexpected address`);
    }
    if (storedText !== text) {
      throw new Error(
        `ENS ${name} has different records and cannot be overwritten`,
      );
    }
  }

  private async existingText(name: string): Promise<string | undefined> {
    const owner = await this.reader.owner(name);
    return sameAddress(owner, zeroAddress)
      ? undefined
      : this.reader.text(name, "agent-context");
  }
}

function roleAddress(
  config: ApiConfig,
  role: FleetRole,
): EvmAddress | undefined {
  return ({
    scout: config.ENS_SCOUT_ADDRESS,
    risk: config.ENS_RISK_ADDRESS,
    trader: config.ENS_TRADER_ADDRESS,
    auditor: config.ENS_AUDITOR_ADDRESS,
  }[role] ?? undefined) as EvmAddress | undefined;
}

function issuedAt(raw?: string): Date | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { updatedAt?: unknown };
    if (typeof value.updatedAt !== "string") return undefined;
    const parsed = new Date(value.updatedAt);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
