"use client";

import {
  EthereumWalletConnectors,
  isEthereumWallet,
} from "@dynamic-labs/ethereum";
import {
  DynamicContextProvider,
  useDynamicContext,
} from "@dynamic-labs/sdk-react-core";
import { useMemo, type ReactNode } from "react";
import {
  WalletAccessContext,
  type WalletAccess,
} from "./wallet-access-context";
import { walletNetworks } from "./wallet-networks";

export function DynamicWalletProvider({
  environmentId,
  children,
}: {
  environmentId: string;
  children: ReactNode;
}) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId,
        walletConnectors: [EthereumWalletConnectors],
        initialAuthenticationMode: "connect-only",
        socialProvidersFilter: (providers) => providers,
        overrides: {
          evmNetworks: walletNetworks,
        },
      }}
    >
      <DynamicWalletBridge>{children}</DynamicWalletBridge>
    </DynamicContextProvider>
  );
}

function DynamicWalletBridge({ children }: { children: ReactNode }) {
  const {
    primaryWallet,
    setShowAuthFlow,
    handleLogOut,
    sdkHasLoaded,
  } = useDynamicContext();
  const rawAddress = primaryWallet?.address;
  const address =
    rawAddress?.startsWith("0x") && rawAddress.length === 42
      ? (rawAddress.toLowerCase() as `0x${string}`)
      : undefined;

  const value = useMemo<WalletAccess>(
    () => ({
      enabled: true,
      loaded: sdkHasLoaded,
      connected: Boolean(primaryWallet && address),
      address,
      open: () => setShowAuthFlow(true),
      logout: handleLogOut,
      signMessage: async (message) => {
        if (!primaryWallet || !address) {
          throw new Error("Connect an EVM wallet first");
        }
        const signature = await primaryWallet.signMessage(message);
        if (!signature) {
          throw new Error("The wallet returned an empty signature");
        }
        return signature as `0x${string}`;
      },
      getEvmClients: async (chainId) => {
        if (!primaryWallet || !address || !isEthereumWallet(primaryWallet)) {
          throw new Error("Connect an EVM wallet first");
        }
        await primaryWallet.switchNetwork(chainId);
        const [walletClient, publicClient] = await Promise.all([
          primaryWallet.getWalletClient(String(chainId)),
          primaryWallet.getPublicClient(),
        ]);
        return { walletClient, publicClient };
      },
    }),
    [
      address,
      handleLogOut,
      primaryWallet,
      sdkHasLoaded,
      setShowAuthFlow,
    ],
  );

  return (
    <WalletAccessContext.Provider value={value}>
      {children}
    </WalletAccessContext.Provider>
  );
}
