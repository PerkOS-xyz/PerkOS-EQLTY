import {
  decodeAbiParameters,
  formatUnits,
  type Hex,
} from "viem";

export type GraphPool = {
  ticker: string;
  tokenAddress: string;
  poolId: string;
};

export type GraphStreamEvent = {
  address: string;
  topics: string[];
  transactionHash: string;
  data: Hex;
  ticker: string;
  poolIdentifier: string;
  protocol: string;
};

export type GraphSwapEvidence = {
  source: "the-graph-substreams";
  ticker: string;
  chainId: "eip155:4663";
  protocol: "v4";
  blockNumber: string;
  liquidityUsd: number;
  lastSwapPrice: number;
  poolAddress: string;
  poolIdentifier: string;
  transactionHash: string;
  topic: string;
  capturedAt: string;
};

export function decodeGraphSwap(
  pool: GraphPool,
  event: GraphStreamEvent,
  blockNumber: string,
  capturedAt: string,
  poolManager: string,
): GraphSwapEvidence {
  const [amount0, amount1, sqrtPriceX96, liquidity] = decodeAbiParameters(
    [
      { type: "int128" },
      { type: "int128" },
      { type: "uint160" },
      { type: "uint128" },
      { type: "int24" },
      { type: "uint24" },
    ],
    event.data,
  );
  const quoteIsToken0 =
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168" <
    pool.tokenAddress.toLowerCase();
  const quoteAmount = decimalAbs(quoteIsToken0 ? amount0 : amount1, 6);
  const stockAmount = decimalAbs(quoteIsToken0 ? amount1 : amount0, 18);
  const lastSwapPrice = quoteAmount / stockAmount;
  const q96 = 2n ** 96n;
  const virtual0 = (liquidity * q96) / sqrtPriceX96;
  const virtual1 = (liquidity * sqrtPriceX96) / q96;
  const virtualQuote = Number(
    formatUnits(quoteIsToken0 ? virtual0 : virtual1, 6),
  );
  const virtualStock = Number(
    formatUnits(quoteIsToken0 ? virtual1 : virtual0, 18),
  );
  return {
    source: "the-graph-substreams",
    ticker: pool.ticker,
    chainId: "eip155:4663",
    protocol: "v4",
    blockNumber,
    liquidityUsd: virtualQuote + virtualStock * lastSwapPrice,
    lastSwapPrice,
    poolAddress: poolManager,
    poolIdentifier: pool.poolId,
    transactionHash: event.transactionHash,
    topic: event.topics[0]!,
    capturedAt,
  };
}

function decimalAbs(value: bigint, decimals: number): number {
  return Number(formatUnits(value < 0n ? -value : value, decimals));
}
