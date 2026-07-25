import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import type {
  ExecutionStrategy,
  NewStrategy,
  TradeRun,
} from "./execution-types.js";
import type { EvmAddress } from "./market-types.js";

type Dependencies = {
  id?: () => string;
  now?: () => number;
};

export class StrategyStore {
  private readonly strategies = new Map<string, ExecutionStrategy>();
  private readonly runs = new Map<string, TradeRun>();
  private readonly id: () => string;
  private readonly now: () => number;

  constructor(dependencies: Dependencies = {}) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? Date.now;
  }

  create(input: NewStrategy): ExecutionStrategy {
    const id = this.id();
    const strategy: ExecutionStrategy = {
      ...input,
      id,
      spent: "0",
      status: "active",
      humanProof: {
        provider: "owner-wallet-session",
        status: "verified",
        proofHash: keccak256(
          stringToHex(`${id}:${input.owner.toLowerCase()}`),
        ),
      },
    };
    this.strategies.set(id, strategy);
    return structuredClone(strategy);
  }

  strategy(
    id: string,
    owner: EvmAddress,
  ): ExecutionStrategy | undefined {
    const strategy = this.strategies.get(id);
    if (
      !strategy ||
      strategy.owner.toLowerCase() !== owner.toLowerCase()
    ) {
      return undefined;
    }
    if (
      strategy.status === "active" &&
      Date.parse(strategy.expiresAt) <= this.now()
    ) {
      strategy.status = "expired";
    }
    return structuredClone(strategy);
  }

  saveRun(run: TradeRun): TradeRun {
    this.runs.set(run.id, structuredClone(run));
    return structuredClone(run);
  }

  run(id: string, owner: EvmAddress): TradeRun | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    const strategy = this.strategies.get(run.strategyId);
    return strategy?.owner.toLowerCase() === owner.toLowerCase()
      ? structuredClone(run)
      : undefined;
  }
}
