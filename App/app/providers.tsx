"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  disabledWalletAccess,
  WalletAccessContext,
} from "./wallet-access-context";

const DynamicWalletProvider = dynamic(
  () =>
    import("./dynamic-wallet-provider").then(
      (module) => module.DynamicWalletProvider,
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

export function Providers({ children }: { children: ReactNode }) {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

  if (!environmentId) {
    return (
      <WalletAccessContext.Provider value={disabledWalletAccess}>
        {children}
      </WalletAccessContext.Provider>
    );
  }

  return (
    <DynamicWalletProvider environmentId={environmentId}>
      {children}
    </DynamicWalletProvider>
  );
}
