import type { ApiConfig } from "./config.js";

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
  integrations: {
    ens: "pending";
    oneclaw: "pending";
    theGraph: "pending";
    uniswap: "ready" | "pending";
    world: "pending";
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
    integrations: {
      ens: "pending",
      oneclaw: "pending",
      theGraph: "pending",
      uniswap:
        config.UNISWAP_API_KEY && config.SWAPPER_ADDRESS
          ? "ready"
          : "pending",
      world: "pending",
    },
  };
}
