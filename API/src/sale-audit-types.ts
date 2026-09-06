import type { EvmAddress } from "./market-types.js";

export type SaleAuditRecord = {
  schema: "urn:eqlty:sale-audit:v1";
  recordedAt: string;
  owner: EvmAddress;
  ticker: string;
  transactionHash: `0x${string}`;
  approvalTransactionHash?: `0x${string}`;
  trade: {
    chainId: 4663;
      direction: "sell";
      tokenIn: EvmAddress;
      tokenInDecimals: number;
      tokenOut: EvmAddress;
    amountIn: string;
    quotedAmountOut: string;
    actualAmountOut: string;
    requestId: string;
    routing: string;
    router: EvmAddress;
  };
  graph: {
    request: {
      method: "POST" | "eth_getLogs";
      endpoint: string;
      authorization: "Bearer [server credential]" | "Server managed";
      body: { ticker: string; chainId: "eip155:4663" };
    };
    response: {
      status: "observed" | "indexed-nearby" | "unavailable";
      source: "the-graph-substreams" | "robinhood-rpc";
      provider?: string;
      package?: string;
      module?: "map_pool_events" | "eth_getLogs";
      evidenceTransaction?: `0x${string}`;
      saleTransaction: `0x${string}`;
      saleObserved: boolean;
      evidenceBlock?: string;
      processedBlock?: string;
      headBlock?: string;
      lagBlocks?: number;
      poolManager?: EvmAddress;
      poolId?: string;
      salePoolManager: EvmAddress;
      salePoolId: string;
      poolMatched: boolean;
      capturedAt?: string;
      error?: string;
    };
  };
  receipt: {
    chainId: 4663;
    status: "success";
    blockNumber: string;
    blockHash: `0x${string}`;
    from: EvmAddress;
    to: EvmAddress;
    gasUsed: string;
    effectiveGasPrice: string;
    swapLogIndex: number;
  };
  transfers: Array<{
    token: EvmAddress;
    symbol: string;
    from: EvmAddress;
    to: EvmAddress;
    amount: string;
    logIndex: number;
  }>;
};

export type SaleAuditBundle = SaleAuditRecord & {
  bundleHash: `0x${string}`;
};

export type SaleHistory = {
  entries: SaleAuditBundle[];
};
