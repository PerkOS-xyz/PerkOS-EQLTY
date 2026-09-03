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

export type FleetFundingRequirements = {
  scheme: "exact";
  network: "robinhood";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  extra: {
    name: string;
    version: string;
  };
};

export type FleetFundingQuote = {
  amount: string;
  symbol: "USDG";
  network: "eip155:4663";
  requirements: FleetFundingRequirements;
};

export type FleetFundingPayment = {
  x402Version: 1;
  scheme: "exact";
  network: "robinhood";
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
};

export type FleetFundingReceipt = {
  wallet: `0x${string}`;
  creditsUsd: number;
  deposited: number;
  network: "robinhood";
  transaction: `0x${string}`;
};

export type FleetComputeStatus = {
  creditsUsd: number;
  estimatedFleetMinutes: number | null;
  rateUsdPerActiveAgentHour: number;
  state: "sponsored" | "funded" | "exhausted" | "unfunded";
  updatedAt?: string;
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

export type OneClawIntegrationHealth = {
  configured: boolean;
  status: "ready" | "degraded" | "pending";
  checkedAt: string;
  platformApi: boolean;
  reason?:
    | "not-configured"
    | "unreachable"
    | "unauthorized"
    | "provider-error";
};

export type OneClawUserConnection = {
  status: "not_connected" | "claim_pending" | "active";
  connectionId?: string;
  oneclawAgentId?: string;
  vaultId?: string;
  claimedAt?: string;
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
    };
    security: {
      provider: string;
      enforcement: string;
      policyRef: string;
    };
  };
};

export type FleetPolicy = {
  schema: "urn:eqlty:ens-fleet-policy:v1";
  source: "durin";
  chainId: number;
  rootName: string;
  manifestHash: `0x${string}`;
  resolvedAt: string;
  version: number;
  paused: boolean;
  allowedTickers: string[];
  limits: {
    maxAmountPerTrade: string;
    maxDeviationBps: number;
    minLiquidityUsd: number;
    maxOracleAgeSeconds: number;
  };
};

export type FleetPolicyChange = {
  paused: boolean;
  allowedTickers: string[];
  maxAmountPerTrade: string;
  maxDeviationBps: number;
  minLiquidityUsd: number;
  maxOracleAgeSeconds: number;
};

export type FleetPolicyPublication = {
  rootName: string;
  manifestHash: `0x${string}`;
  manifest: {
    version: number;
    paused: boolean;
  };
  diff: Array<{
    field: string;
    before: boolean | number | string | string[];
    after: boolean | number | string | string[];
  }>;
  transactions: Array<`0x${string}`>;
  verified: true;
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
