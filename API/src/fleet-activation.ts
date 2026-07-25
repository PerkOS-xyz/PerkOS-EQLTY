import type { ApiConfig } from "./config.js";
import type { DurinFleetProvisioner } from "./durin-provisioner.js";
import { DurinFleetProvisioner as FleetProvisioner } from "./durin-provisioner.js";
import type { EnsControlPlaneService } from "./ens-control-plane.js";
import { EnsControlPlaneService as ControlPlane } from "./ens-control-plane.js";
import { fleetNames } from "./ens-names.js";
import type {
  EnsControlPlane,
} from "./ens-types.js";
import type {
  FleetRole,
  FleetRuntime,
} from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";
import type { PerkosFleetService } from "./perkos-fleet.js";
import { PerkosFleetService as PerkosFleet } from "./perkos-fleet.js";

type Dependencies = {
  perkos?: Pick<PerkosFleetService, "activate">;
  controlPlane?: Pick<EnsControlPlaneService, "resolve">;
  provisioner?: Pick<DurinFleetProvisioner, "provision">;
  ensResolveTimeoutMs?: number;
};

const defaultEnsResolveTimeoutMs = 3_000;

type PendingActivation = {
  status: "provisioning";
  userId: string;
  owner: EvmAddress;
  rootName: string;
  agents: Record<FleetRole, string>;
  transactions: [];
  verified: false;
  runtime: FleetRuntime;
};

type VerifiedActivation = {
  status: "provisioned" | "reactivated";
  userId: string;
  owner: EvmAddress;
  rootName: string;
  agents: Record<FleetRole, string>;
  manifestHash: `0x${string}`;
  transactions: `0x${string}`[];
  verified: true;
  runtime: FleetRuntime;
};

export type FleetActivation = PendingActivation | VerifiedActivation;

export class FleetActivationService {
  private readonly perkos: Pick<PerkosFleetService, "activate">;
  private readonly controlPlane: Pick<EnsControlPlaneService, "resolve">;
  private readonly provisioner: Pick<DurinFleetProvisioner, "provision">;
  private readonly ensResolveTimeoutMs: number;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.perkos = dependencies.perkos ?? new PerkosFleet(config);
    this.controlPlane =
      dependencies.controlPlane ?? new ControlPlane(config);
    this.provisioner =
      dependencies.provisioner ?? new FleetProvisioner(config);
    this.ensResolveTimeoutMs =
      dependencies.ensResolveTimeoutMs ?? defaultEnsResolveTimeoutMs;
  }

  async activate(input: {
    userId: string;
    owner: EvmAddress;
    perkosIdToken?: string;
  }): Promise<FleetActivation> {
    if (!this.config.ENS_ROOT_NAME) {
      throw new Error("ENS root name is not configured");
    }
    const runtime = await this.perkos.activate({
      owner: input.owner,
      userId: input.userId,
      idToken: input.perkosIdToken,
    });
    const names = fleetNames(input.userId, this.config.ENS_ROOT_NAME);
    const runtimeAgents = Object.fromEntries(
      runtime.agents.map((agent) => [
        agent.role,
        agent.agentId ?? agent.name,
      ]),
    ) as Record<FleetRole, string>;
    const agentIds = realAgentIds(runtime);
    if (!agentIds) {
      return {
        status: "provisioning",
        userId: input.userId,
        owner: input.owner,
        rootName: names.user,
        agents: runtimeAgents,
        transactions: [],
        verified: false,
        runtime,
      };
    }

    const existing = await this.resolveControlPlane({
      userId: input.userId,
      owner: input.owner,
    });
    if (!existing) {
      return this.pendingActivation(input, names.user, runtime);
    }
    if (existing.status === "invalid") {
      throw new Error(
        existing.error ?? "ENS fleet records failed verification",
      );
    }
    if (
      existing.status === "active" &&
      existing.rootName &&
      existing.manifestHash
    ) {
      return {
        status: "reactivated",
        userId: input.userId,
        owner: input.owner,
        rootName: existing.rootName,
        agents: settingsAgentIds(existing.agentSettings, agentIds),
        manifestHash: existing.manifestHash,
        transactions: [],
        verified: true,
        runtime,
      };
    }

    const provisioned = await this.provisioner.provision({
      userId: input.userId,
      owner: input.owner,
      agentIds,
    });
    const verified = await this.controlPlane.resolve({
      userId: input.userId,
      owner: input.owner,
    });
    if (
      verified.status !== "active" ||
      !verified.rootName ||
      !verified.manifestHash
    ) {
      throw new Error(
        verified.error ?? "ENS fleet verification did not become active",
      );
    }
    return {
      status: "provisioned",
      userId: input.userId,
      owner: input.owner,
      rootName: verified.rootName,
      agents: agentIds,
      manifestHash: verified.manifestHash,
      transactions: provisioned.transactions,
      verified: true,
      runtime,
    };
  }

  private pendingActivation(
    input: { userId: string; owner: EvmAddress },
    rootName: string,
    runtime: FleetRuntime,
  ): PendingActivation {
    const agents = Object.fromEntries(
      runtime.agents.map((agent) => [agent.role, agent.agentId ?? agent.name]),
    ) as Record<FleetRole, string>;
    return {
      status: "provisioning",
      userId: input.userId,
      owner: input.owner,
      rootName,
      agents,
      transactions: [],
      verified: false,
      runtime,
    };
  }

  private async resolveControlPlane(input: {
    userId: string;
    owner: EvmAddress;
  }): Promise<EnsControlPlane | undefined> {
    let timer: number | undefined;
    try {
      return await Promise.race([
        this.controlPlane.resolve(input),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(resolve, this.ensResolveTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function realAgentIds(
  runtime: FleetRuntime,
): Record<FleetRole, string> | undefined {
  const agents = {} as Record<FleetRole, string>;
  for (const { role } of fleetRoles) {
    const agent = runtime.agents.find((candidate) => candidate.role === role);
    if (!agent?.agentId) return undefined;
    agents[role] = agent.agentId;
  }
  return agents;
}

function settingsAgentIds(
  settings:
    | Partial<Record<FleetRole, { perkosAgentId: string }>>
    | undefined,
  fallback: Record<FleetRole, string>,
): Record<FleetRole, string> {
  return Object.fromEntries(
    fleetRoles.map(({ role }) => [
      role,
      settings?.[role]?.perkosAgentId ?? fallback[role],
    ]),
  ) as Record<FleetRole, string>;
}
