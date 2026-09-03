"use client";

import { useState } from "react";
import { useWalletAccess } from "./wallet-access-context";

function shortAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AccessButton() {
  const wallet = useWalletAccess();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!wallet.enabled) {
    return (
      <button className="accessButton" disabled type="button">
        Wallet setup
      </button>
    );
  }

  if (!wallet.loaded) {
    return (
      <button className="accessButton" disabled type="button">
        Restoring wallet…
      </button>
    );
  }

  if (!wallet.connected || !wallet.address) {
    return (
      <button className="accessButton ready" onClick={wallet.open} type="button">
        Connect wallet
      </button>
    );
  }

  async function disconnect() {
    setLoggingOut(true);
    try {
      await wallet.logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <button
      className="accessButton connected"
      disabled={loggingOut}
      onClick={disconnect}
      title="Disconnect wallet"
      type="button"
    >
      <i />
      {loggingOut ? "Disconnecting" : shortAddress(wallet.address)}
    </button>
  );
}
