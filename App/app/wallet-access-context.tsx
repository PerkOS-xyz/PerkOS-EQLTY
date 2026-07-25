"use client";

import { createContext, useContext } from "react";
import type {
  Account,
  Chain,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";

export type EvmClients = {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
};

export type WalletAccess = {
  enabled: boolean;
  loaded: boolean;
  connected: boolean;
  address?: `0x${string}`;
  open: () => void;
  logout: () => Promise<void>;
  signMessage: (message: string) => Promise<`0x${string}`>;
  getEvmClients: (chainId: number) => Promise<EvmClients>;
};

export const disabledWalletAccess: WalletAccess = {
  enabled: false,
  loaded: true,
  connected: false,
  open: () => undefined,
  logout: async () => undefined,
  signMessage: async () => {
    throw new Error("Wallet access is not configured");
  },
  getEvmClients: async () => {
    throw new Error("Wallet access is not configured");
  },
};

export const WalletAccessContext =
  createContext<WalletAccess>(disabledWalletAccess);

export function useWalletAccess(): WalletAccess {
  return useContext(WalletAccessContext);
}
