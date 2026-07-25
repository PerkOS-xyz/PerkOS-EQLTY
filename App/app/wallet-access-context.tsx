"use client";

import { createContext, useContext } from "react";

export type WalletAccess = {
  enabled: boolean;
  loaded: boolean;
  connected: boolean;
  address?: `0x${string}`;
  open: () => void;
  logout: () => Promise<void>;
  signMessage: (message: string) => Promise<`0x${string}`>;
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
};

export const WalletAccessContext =
  createContext<WalletAccess>(disabledWalletAccess);

export function useWalletAccess(): WalletAccess {
  return useContext(WalletAccessContext);
}
