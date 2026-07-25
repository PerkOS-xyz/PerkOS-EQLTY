function rpcUrl(variable: string | undefined, fallback: string): string {
  return variable?.trim() || fallback;
}

export const walletNetworks = [
  {
    chainId: 4663,
    networkId: 4663,
    name: "Robinhood Chain",
    vanityName: "Robinhood",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: [
      rpcUrl(
        process.env.NEXT_PUBLIC_EQLTY_ROBINHOOD_MAINNET_RPC_URL,
        "https://rpc.mainnet.chain.robinhood.com",
      ),
    ],
    blockExplorerUrls: ["https://explorer.chain.robinhood.com"],
    iconUrls: [],
  },
  {
    chainId: 46630,
    networkId: 46630,
    name: "Robinhood Chain Testnet",
    vanityName: "Robinhood Testnet",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: [
      rpcUrl(
        process.env.NEXT_PUBLIC_EQLTY_ROBINHOOD_TESTNET_RPC_URL,
        "https://rpc.testnet.chain.robinhood.com",
      ),
    ],
    blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
    iconUrls: [],
  },
  {
    chainId: 11155111,
    networkId: 11155111,
    name: "Sepolia",
    vanityName: "Sepolia",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: [
      rpcUrl(
        process.env.NEXT_PUBLIC_EQLTY_SEPOLIA_RPC_URL,
        "https://ethereum-sepolia-rpc.publicnode.com",
      ),
    ],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    iconUrls: [],
  },
];
