import type { ExecutionStrategy } from "./execution-types.js";
import type { PreparedUniswapSwap } from "./market-types.js";

export type TradeExecutionInput = {
  strategy: ExecutionStrategy;
  amountIn: string;
  signalHash: `0x${string}`;
};

export type TradeExecutionReceipt = {
  transactionHash: `0x${string}`;
  requestId: string;
  routing: string;
  quotedAmountOut: string;
};

export interface TradeExecutor {
  ready(): boolean;
  prepare(input: {
    strategy: ExecutionStrategy;
    amountIn: string;
  }): Promise<PreparedUniswapSwap>;
  execute(
    input: TradeExecutionInput,
    prepared: PreparedUniswapSwap,
  ): Promise<TradeExecutionReceipt>;
}

export const disabledTradeExecutor: TradeExecutor = {
  ready: () => false,
  prepare: async () => {
    throw new Error("Live contract execution is not configured");
  },
  execute: async () => {
    throw new Error("Live contract execution is not configured");
  },
};
