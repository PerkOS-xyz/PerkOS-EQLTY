import type {
  AgentHandoff,
  RunStep,
} from "./execution-types.js";
import type { EvmAddress } from "./market-types.js";
import type { OneClawGate } from "./oneclaw-policy.js";

export type PurchaseAuditBundle = {
  schema: "urn:eqlty:purchase-audit:v1";
  bundleHash: `0x${string}`;
  recordedAt: string;
  owner: EvmAddress;
  ticker: string;
  transactionHash: `0x${string}`;
  strategy: {
    appId: string;
    onchainId: string;
    agent: EvmAddress;
    vault: EvmAddress;
    inputToken: EvmAddress;
    outputToken: EvmAddress;
    router: EvmAddress;
    amountIn: string;
    maxSlippageBps: number;
    expiresAt: string;
    setupTransactions: {
      creation: `0x${string}`;
      approval: `0x${string}`;
      funding: `0x${string}`;
    };
  };
  ens: {
    status: "verified";
    manifestHash?: string;
    detail?: string;
  };
  graph: {
    request: {
      method: "POST";
      endpoint: string;
      authorization: "Bearer [server credential]";
      body: { ticker: string; chainId: "eip155:4663" };
    };
    response: {
      source: "the-graph-substreams";
      provider?: string;
      package?: string;
      module?: "map_pool_events";
      evidenceTransaction?: `0x${string}`;
      evidenceBlock: string;
      checkpointBlock?: string;
      processedBlock?: string;
      headBlock?: string;
      lagBlocks?: number;
      poolManager: EvmAddress;
      poolId: string;
      eventTopic: `0x${string}`;
      capturedAt: string;
    };
  };
  uniswap: {
    routing: string;
    requestId: string;
    quotedAmountOut: string;
    router: EvmAddress;
    poolManager: EvmAddress;
    poolId: string;
    poolMatchedGraphEvidence: boolean;
  };
  proofs: {
    proofBundleRoot?: `0x${string}`;
    signalHash: `0x${string}`;
    quoteHash: `0x${string}`;
    handoffs: Array<{
      from: string;
      to: string;
      kind: string;
      outputHash: `0x${string}`;
    }>;
  };
  receipt: {
    chainId: 4663;
    status: "success";
    blockNumber: string;
    blockHash: `0x${string}`;
    from: EvmAddress;
    to?: EvmAddress;
    gasUsed: string;
    effectiveGasPrice: string;
    tradeLogIndex: number;
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
  workflow: {
    steps: RunStep[];
    handoffs: AgentHandoff[];
    oneclaw: OneClawGate;
  };
};

export type PurchaseAuditRecord = Omit<
  PurchaseAuditBundle,
  "bundleHash"
>;
