"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import {
  readRecoverableStrategies,
  withdrawRecoverableStrategy,
  type RecoverableStrategy,
} from "../../lib/eqlty-vault";
import {
  readExecutionConfig,
  transactionUrl,
} from "../../lib/execution-api";
import { useWalletAccess } from "../wallet-access-context";

type RecoveryState = {
  phase: "loading" | "ready" | "withdrawing" | "error";
  strategies: RecoverableStrategy[];
  vault?: Address;
  activeStrategyId?: string;
  transactionHash?: Hex;
  error?: string;
};

const initialState: RecoveryState = {
  phase: "loading",
  strategies: [],
};

export function RecoverableFunds() {
  const wallet = useWalletAccess();
  const [state, setState] = useState<RecoveryState>(initialState);

  const load = useCallback(async () => {
    if (!wallet.connected || !wallet.address) {
      setState({ phase: "ready", strategies: [] });
      return;
    }
    setState((current) => ({
      ...current,
      phase: "loading",
      error: undefined,
    }));
    try {
      const config = await readExecutionConfig();
      const vault = config.contracts.eqltyVault;
      if (!vault) {
        setState({ phase: "ready", strategies: [] });
        return;
      }
      const strategies = await readRecoverableStrategies({
        wallet,
        vault,
      });
      setState({ phase: "ready", strategies, vault });
    } catch (cause) {
      setState({
        phase: "error",
        strategies: [],
        error:
          cause instanceof Error
            ? cause.message
            : "Strategy balances are unavailable",
      });
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw(strategy: RecoverableStrategy) {
    if (!state.vault || state.phase === "withdrawing") return;
    setState((current) => ({
      ...current,
      phase: "withdrawing",
      activeStrategyId: strategy.strategyId,
      error: undefined,
      transactionHash: undefined,
    }));
    try {
      const transactionHash = await withdrawRecoverableStrategy({
        wallet,
        vault: state.vault,
        strategy,
      });
      const strategies = await readRecoverableStrategies({
        wallet,
        vault: state.vault,
      });
      setState({
        phase: "ready",
        strategies,
        vault: state.vault,
        transactionHash,
      });
    } catch (cause) {
      setState((current) => ({
        ...current,
        phase: "error",
        error:
          cause instanceof Error
            ? cause.message
            : "The strategy withdrawal failed",
      }));
    }
  }

  if (
    state.phase === "loading" ||
    (state.phase === "ready" &&
      state.strategies.length === 0 &&
      !state.transactionHash)
  ) {
    return null;
  }

  return (
    <section className="recoverableFunds" aria-label="Recoverable strategy funds">
      <header>
        <div>
          <span>Vault controls</span>
          <strong>Unused strategy funds</strong>
        </div>
        <small>Owner-only withdrawal</small>
      </header>
      {state.strategies.map((strategy) => (
        <article key={strategy.strategyId}>
          <div>
            <strong>{formatUsdG(strategy.amount)} USDG</strong>
            <span>Strategy #{strategy.strategyId}</span>
          </div>
          <button
            disabled={state.phase === "withdrawing"}
            onClick={() => void withdraw(strategy)}
            type="button"
          >
            {state.phase === "withdrawing" &&
            state.activeStrategyId === strategy.strategyId
              ? "Confirm in wallet..."
              : "Return to wallet"}
          </button>
        </article>
      ))}
      {state.transactionHash && (
        <a
          href={transactionUrl(state.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          Funds returned · Verify transaction ↗
        </a>
      )}
      {state.error && (
        <p>
          {state.error}{" "}
          <button onClick={() => void load()} type="button">
            Try again
          </button>
        </p>
      )}
    </section>
  );
}

function formatUsdG(amount: string): string {
  const value = amount.padStart(7, "0");
  const whole = value.slice(0, -6);
  const fraction = value.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
