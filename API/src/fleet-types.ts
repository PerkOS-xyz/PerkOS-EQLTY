export type FleetRole = "scout" | "risk" | "trader" | "auditor";

export type FleetAgentState =
  | "planned"
  | "provisioning"
  | "ready"
  | "waking"
  | "failed";

export type FleetAgent = {
  role: FleetRole;
  agentId?: string;
  name: string;
  runtime: "Hermes";
  state: FleetAgentState;
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

export type FleetRoleDefinition = {
  role: FleetRole;
  plugins: string[];
  skillIds: string[];
};

export const fleetRoles: FleetRoleDefinition[] = [
  {
    role: "scout",
    plugins: ["EQLTY-The-Graph-Plugin", "EQLTY-ENS-Plugin"],
    skillIds: ["eqlty-graph", "eqlty-ens"],
  },
  {
    role: "risk",
    plugins: ["EQLTY-The-Graph-Plugin", "EQLTY-ENS-Plugin"],
    skillIds: ["eqlty-graph", "eqlty-ens"],
  },
  {
    role: "trader",
    plugins: ["EQLTY-Uniswap-Plugin", "EQLTY-ENS-Plugin"],
    skillIds: ["eqlty-uniswap", "eqlty-ens"],
  },
  {
    role: "auditor",
    plugins: [
      "EQLTY-The-Graph-Plugin",
      "EQLTY-Uniswap-Plugin",
      "EQLTY-ENS-Plugin",
    ],
    skillIds: ["eqlty-graph", "eqlty-uniswap", "eqlty-ens"],
  },
];
