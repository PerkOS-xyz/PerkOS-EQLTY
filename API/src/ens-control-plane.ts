import type { ApiConfig } from "./config.js";
import type { DurinReader } from "./durin-reader.js";
import { ViemDurinReader } from "./durin-reader.js";
import { fleetNames } from "./ens-names.js";
import {
  hashEnsRecord,
  parseAgentSettings,
  parseManifest,
} from "./ens-policy.js";
import type {
  EnsAgentSettings,
  EnsControlPlane,
} from "./ens-types.js";
import type { FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

const zeroAddress = "0x0000000000000000000000000000000000000000";

type Dependencies = {
  reader?: DurinReader;
  now?: () => Date;
};

export class EnsControlPlaneService {
  private readonly reader: DurinReader;
  private readonly now: () => Date;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.reader = dependencies.reader ?? new ViemDurinReader(config);
    this.now = dependencies.now ?? (() => new Date());
  }

  async resolve(input: {
    userId: string;
    owner: EvmAddress;
    allowExpired?: boolean;
  }): Promise<EnsControlPlane> {
    const resolvedAt = this.now().toISOString();
    if (!this.config.ENS_ROOT_NAME || !this.reader.ready()) {
      return {
        source: "durin",
        mode: "live",
        status: "unavailable",
        rootName: this.config.ENS_ROOT_NAME,
        resolvedAt,
        error: "ENS L2 records are not configured",
      };
    }

    const names = fleetNames(input.userId, this.config.ENS_ROOT_NAME);
    try {
      const rootOwner = await this.reader.owner(names.user);
      if (sameAddress(rootOwner, zeroAddress)) {
        return {
          source: "durin",
          mode: "live",
          status: "unavailable",
          rootName: names.user,
          resolvedAt,
          error: "The owner fleet name is not registered",
        };
      }
      if (!sameAddress(rootOwner, input.owner)) {
        throw new Error("The fleet name is owned by another wallet");
      }

      const rawManifest = await this.reader.text(
        names.user,
        "agent-context",
      );
      if (!rawManifest) {
        throw new Error("The fleet manifest record is empty");
      }
      const manifest = parseManifest(
        rawManifest,
        names.user,
        this.config.ROBINHOOD_CHAIN_ID,
        this.config.ENS_POLICY_TTL_SECONDS,
        this.now(),
        input.allowExpired ?? false,
      );
      if (!manifest.agentSettings) {
        throw new Error("The fleet manifest has no agent settings hashes");
      }

      const settings = {} as Record<FleetRole, EnsAgentSettings>;
      for (const { role } of fleetRoles) {
        const name = names.agents[role];
        const reference = manifest.agentSettings[role];
        const [agentOwner, agentAddress, rawSettings] = await Promise.all([
          this.reader.owner(name),
          this.reader.address(name),
          this.reader.text(name, reference.recordKey),
        ]);
        if (!sameAddress(agentOwner, input.owner)) {
          throw new Error(`The ${role} name has an unexpected owner`);
        }
        const expectedAddress = roleAddress(this.config, role);
        if (
          expectedAddress &&
          !sameAddress(agentAddress, expectedAddress)
        ) {
          throw new Error(`The ${role} address record does not match`);
        }
        if (!rawSettings) {
          throw new Error(`The ${role} settings record is empty`);
        }
        if (
          hashEnsRecord(rawSettings).toLowerCase() !==
          reference.hash.toLowerCase()
        ) {
          throw new Error(`The ${role} settings hash does not match`);
        }
        const parsed = parseAgentSettings(rawSettings, role, name);
        if (parsed.version !== manifest.version) {
          throw new Error(`The ${role} settings version does not match`);
        }
        settings[role] = parsed;
      }

      return {
        source: "durin",
        mode: "live",
        status: "active",
        rootName: names.user,
        manifestHash: hashEnsRecord(rawManifest),
        resolvedAt,
        owner: input.owner.toLowerCase() as EvmAddress,
        manifest,
        agentSettings: settings,
      };
    } catch (error) {
      return {
        source: "durin",
        mode: "live",
        status: "invalid",
        rootName: names.user,
        resolvedAt,
        error:
          error instanceof Error
            ? error.message
            : "ENS control plane resolution failed",
      };
    }
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
