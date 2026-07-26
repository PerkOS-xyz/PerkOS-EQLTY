import type { ApiConfig } from "./config.js";
import { executionTraderAddress } from "./execution-addresses.js";

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
    oneclaw: "pending";
    perkos: "disabled" | "live" | "preview";
    theGraph: "ready" | "pending";
    uniswap: "ready" | "pending";
  };
};

export function publicConfig(config: ApiConfig): PublicApiConfig {
  const executionName =
    config.ROBINHOOD_CHAIN_ID === 46630
      ? "Robinhood Testnet"
      : "Robinhood";

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
      trader: executionTraderAddress(config),
    },
    integrations: {
      ens:
        config.ENS_ROOT_NAME &&
        config.EQLTY_ENS_RECORDS_RPC_URL &&
        config.EQLTY_ENS_L2_REGISTRY_ADDRESS
          ? "ready"
          : "pending",
      oneclaw: "pending",
      perkos: config.PERKOS_FLEET_MODE,
      theGraph:
        config.EQLTY_GRAPH_ADAPTER_URL || config.GRAPH_RISK_URL
          ? "ready"
          : "pending",
      uniswap:
        config.UNISWAP_API_KEY && config.SWAPPER_ADDRESS
          ? "ready"
          : "pending",
    },
  };
}
