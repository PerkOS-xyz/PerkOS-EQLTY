import type { ApiConfig } from "./config.js";
import { executionTraderAddress } from "./execution-addresses.js";
import type { GraphIntegrationStatus } from "./graph-evidence.js";
import type { OneClawIntegrationStatus } from "./oneclaw-fleet.js";

export type PublicApiConfig = {
  demoMode: boolean;
  projectName: string;
  requireLiveData: boolean;
  network: {
    name: "Robinhood" | "Robinhood Testnet";
    chainId: number;
  };
  networks: {
    execution: {
      name: "Robinhood" | "Robinhood Testnet";
      chainId: number;
    };
    market: {
      name: "Robinhood";
      chainId: number;
    };
  };
  contracts: {
    eqltyVault?: `0x${string}`;
    trader?: `0x${string}`;
  };
  integrations: {
    ens: "ready" | "pending";
    execution: "ready" | "pending";
    oneclaw: "ready" | "degraded" | "pending";
    perkos: "disabled" | "live" | "preview";
    marketEvidence: "ready" | "degraded" | "pending";
    theGraph: "ready" | "degraded" | "pending";
    uniswap: "ready" | "pending";
  };
  integrationHealth: {
    oneclaw: OneClawIntegrationStatus;
    marketEvidence: GraphIntegrationStatus;
    theGraph: GraphIntegrationStatus;
  };
  decisionFee: {
    mode: "preview" | "live";
    scheme: "exact";
    maximumAmount: string;
    completeAmount: string;
    noCandidateAmount: string;
    decimals: 6;
    symbol: "USDG";
  };
  execution: {
    status: "ready" | "pending";
    decisionAuthorization: "live" | "preview";
    protectedPurchases: "enabled" | "blocked";
  };
};

export function publicConfig(
  config: ApiConfig,
  evidenceStatus?: GraphIntegrationStatus,
  oneclawStatus?: OneClawIntegrationStatus,
  executionReady = false,
): PublicApiConfig {
  const executionName =
    config.ROBINHOOD_CHAIN_ID === 46630
      ? "Robinhood Testnet"
      : "Robinhood";
  const marketEvidence =
    evidenceStatus ?? defaultEvidenceStatus(config);
  const graphSelected =
    marketEvidence.evidenceProvider === "the-graph-substreams" ||
    (!marketEvidence.evidenceProvider &&
      config.EQLTY_EVIDENCE_PROVIDER === "graph");
  const theGraph = graphSelected
    ? marketEvidence
    : inactiveGraphStatus(config);
  const oneclaw =
    oneclawStatus ??
    ({
      configured: Boolean(
        config.ONECLAW_PLATFORM_APP_ID &&
          config.ONECLAW_PLATFORM_API_KEY,
      ),
      status:
        config.ONECLAW_PLATFORM_APP_ID &&
        config.ONECLAW_PLATFORM_API_KEY
          ? "degraded"
          : "pending",
      checkedAt: new Date().toISOString(),
      platformApi: false,
      reason:
        config.ONECLAW_PLATFORM_APP_ID &&
        config.ONECLAW_PLATFORM_API_KEY
          ? "unreachable"
          : "not-configured",
    } satisfies OneClawIntegrationStatus);

  return {
    demoMode: config.DEMO_MODE,
    projectName: config.PUBLIC_PROJECT_NAME,
    requireLiveData: config.REQUIRE_LIVE_DATA,
    network: {
      name: executionName,
      chainId: config.ROBINHOOD_CHAIN_ID,
    },
    networks: {
      execution: {
        name: executionName,
        chainId: config.ROBINHOOD_CHAIN_ID,
      },
      market: {
        name: "Robinhood",
        chainId: config.UNISWAP_CHAIN_ID,
      },
    },
    contracts: {
      eqltyVault: config.EQLTY_VAULT_ADDRESS as
        | `0x${string}`
        | undefined,
      trader:
        config.EQLTY_SERVER_WALLET_MODE === "shared"
          ? executionTraderAddress(config)
          : undefined,
    },
    integrations: {
      ens:
        config.ENS_ROOT_NAME &&
        config.EQLTY_ENS_RECORDS_RPC_URL &&
        config.EQLTY_ENS_L2_REGISTRY_ADDRESS
          ? "ready"
          : "pending",
      execution: executionReady ? "ready" : "pending",
      oneclaw: oneclaw.status,
      perkos: config.PERKOS_FLEET_MODE,
      marketEvidence: marketEvidence.status,
      theGraph: theGraph.status,
      uniswap:
        config.UNISWAP_API_KEY && config.SWAPPER_ADDRESS
          ? "ready"
          : "pending",
    },
    integrationHealth: {
      oneclaw,
      marketEvidence,
      theGraph,
    },
    decisionFee: {
      mode: config.EQLTY_DECISION_FEE_MODE,
      scheme: "exact",
      maximumAmount: config.EQLTY_DECISION_FEE_MAX_AMOUNT,
      completeAmount: config.EQLTY_DECISION_FEE_COMPLETE_AMOUNT,
      noCandidateAmount:
        config.EQLTY_DECISION_FEE_NO_CANDIDATE_AMOUNT,
      decimals: 6,
      symbol: "USDG",
    },
    execution: {
      status: executionReady ? "ready" : "pending",
      decisionAuthorization: config.EQLTY_DECISION_FEE_MODE,
      protectedPurchases: config.EQLTY_ONECLAW_LIVE_AUTHORIZATION
        ? "enabled"
        : "blocked",
    },
  };
}

function defaultEvidenceStatus(config: ApiConfig): GraphIntegrationStatus {
  const graph = config.EQLTY_EVIDENCE_PROVIDER === "graph";
  const configured = graph
    ? Boolean(config.EQLTY_GRAPH_ADAPTER_URL ?? config.GRAPH_RISK_URL)
    : Boolean(config.ROBINHOOD_MAINNET_RPC_URL);
  return {
    configured,
    status: configured ? "degraded" : "pending",
    checkedAt: new Date().toISOString(),
    evidenceProvider: graph
      ? "the-graph-substreams"
      : "robinhood-rpc",
    reason: configured ? "unreachable" : "not-configured",
    recovery: {
      state: "action-required",
      action: configured ? "check-provider" : "configure-provider",
      automatic: false,
      message: graph
        ? configured
          ? "The Graph cannot supply verified evidence."
          : "Configure a live Substreams provider before enabling decisions."
        : configured
          ? "The Robinhood Chain RPC cannot supply current evidence."
          : "Configure the Robinhood Chain RPC before enabling decisions.",
    },
  };
}

function inactiveGraphStatus(config: ApiConfig): GraphIntegrationStatus {
  const configured = Boolean(
    config.EQLTY_GRAPH_ADAPTER_URL ?? config.GRAPH_RISK_URL,
  );
  return {
    configured,
    status: "pending",
    checkedAt: new Date().toISOString(),
    evidenceProvider: "the-graph-substreams",
    providerName: "The Graph Substreams",
    recovery: {
      state: "recovering",
      action: "none",
      automatic: true,
      message: configured
        ? "The Graph is configured but the RPC evidence provider is currently selected."
        : "The Graph can be enabled later without changing the decision flow.",
    },
  };
}
