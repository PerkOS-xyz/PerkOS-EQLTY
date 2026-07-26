export type AgentRole = "scout" | "risk" | "trader" | "auditor";

export type AgentState =
  | "planned"
  | "provisioning"
  | "ready"
  | "waking"
  | "failed";

export type FleetAgent = {
  role: AgentRole;
  agentId?: string;
  name: string;
  runtime: "Hermes";
  state: AgentState;
  plugins: string[];
  oneclaw: "pending-agent-credential" | "linked";
  jobId?: string;
};

export type FleetRuntime = {
  provider: "perkos";
  mode: "disabled" | "preview" | "live";
  status: "disabled" | "planned" | "provisioning" | "ready" | "partial";
  imageTag?: string;
  agents: FleetAgent[];
};

export type FleetActivation = {
  status: "provisioning" | "provisioned" | "reactivated";
  userId: string;
  owner: `0x${string}`;
  rootName: string;
  agents: Record<AgentRole, string>;
  manifestHash?: `0x${string}`;
  transactions: Array<`0x${string}`>;
  verified: boolean;
  runtime?: FleetRuntime;
};

export type OneClawFleetSecurity =
  | {
      status: "link_required";
      authorizeUrl: string;
    }
  | {
      status: "claim_required";
      connectionId: string;
      claimUrl: string;
      expiresIn: number;
      vaultId: string;
      executionAgent: {
        role: "trader";
        perkosAgentId: string;
        oneclawAgentId: string;
        walletAddress?: string;
        reprovisionJobId: string;
      };
      eip712Restrictions: "disabled";
    }
  | {
      status: "linked";
      connectionId: string;
      vaultId?: string;
      executionAgent: {
        role: "trader";
        perkosAgentId: string;
        oneclawAgentId: string;
        walletAddress?: string;
      };
      eip712Restrictions: "disabled";
    };

export type UserSession = {
  sub: string;
  provider: "wallet";
  walletAddress: `0x${string}`;
  fleetUserId: string;
  expiresAt: string;
};

export type EnsAgentMetadata = {
  name: string;
  settings: {
    ensName: string;
    behavior: {
      objective: string;
      inputs: string[];
      actions: string[];
      requiresWorldSelfieForChanges: boolean;
    };
    security: {
      provider: string;
      enforcement: string;
      policyRef: string;
    };
  };
};

export type FleetPhase =
  | "idle"
  | "locating"
  | "creating"
  | "provisioning"
  | "waking"
  | "ready"
  | "failed";

export const fleetRoles: Array<{
  role: AgentRole;
  plugins: string[];
}> = [
  { role: "scout", plugins: ["The Graph", "ENS"] },
  { role: "risk", plugins: ["The Graph", "ENS"] },
  { role: "trader", plugins: ["Uniswap", "ENS"] },
  { role: "auditor", plugins: ["Uniswap", "The Graph", "ENS"] },
];
