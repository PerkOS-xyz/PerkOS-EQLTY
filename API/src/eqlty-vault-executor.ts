import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiConfig } from "./config.js";
import {
  eqltyExecutionTypes,
  eqltyVaultAbi,
} from "./eqlty-vault-abi.js";
import type { ExecutionStrategy } from "./execution-types.js";
import type { PreparedUniswapSwap } from "./market-types.js";
import { hashPayload } from "./proof-handoff.js";
import type {
  TradeExecutionInput,
  TradeExecutionReceipt,
  TradeExecutor,
} from "./trade-executor.js";
import { UniswapClient } from "./uniswap-client.js";

const robinhood = (rpcUrl: string) =>
  defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

export class EqltyVaultExecutor implements TradeExecutor {
  private readonly uniswap: UniswapClient;

  constructor(
    private readonly config: ApiConfig,
    dependencies: { uniswap?: UniswapClient } = {},
  ) {
    this.uniswap = dependencies.uniswap ?? new UniswapClient(config);
  }

  ready(): boolean {
    return Boolean(
      this.config.EQLTY_EXECUTION_MODE === "live" &&
        this.config.EQLTY_EXECUTION_CONFIRM === "ROBINHOOD_MAINNET" &&
        this.config.ROBINHOOD_CHAIN_ID === 4663 &&
        this.config.UNISWAP_CHAIN_ID === 4663 &&
        this.config.ROBINHOOD_MAINNET_RPC_URL &&
        this.config.EQLTY_VAULT_ADDRESS &&
        this.config.EQLTY_TRADER_PRIVATE_KEY &&
        this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY &&
        this.uniswap.executionReady(),
    );
  }

  async prepare(input: {
    strategy: ExecutionStrategy;
    amountIn: string;
  }): Promise<PreparedUniswapSwap> {
    this.assertArmed(input.amountIn);
    await this.assertOnchainStrategy(input.strategy, input.amountIn);
    return this.uniswap.prepareSwap({
      tokenOut: input.strategy.outputToken,
      amount: input.amountIn,
      maxSlippageBps: input.strategy.maxSlippageBps,
    });
  }

  async execute(
    input: TradeExecutionInput,
    prepared: PreparedUniswapSwap,
  ): Promise<TradeExecutionReceipt> {
    this.assertArmed(input.amountIn);
    const state = await this.assertOnchainStrategy(
      input.strategy,
      input.amountIn,
    );
    const quoteInput = prepared.rawQuote.input;
    if (
      !quoteInput ||
      typeof quoteInput !== "object" ||
      String((quoteInput as Record<string, unknown>).amount) !== input.amountIn
    ) {
      throw new Error("Prepared quote amount does not match execution");
    }

    const quotedAmountOut = BigInt(prepared.amountOut);
    const minAmountOut =
      (quotedAmountOut *
        BigInt(10_000 - input.strategy.maxSlippageBps)) /
      10_000n;
    const message = {
      strategyId: this.strategyId(),
      amountIn: BigInt(input.amountIn),
      quotedAmountOut,
      minAmountOut,
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 300),
      signalHash: input.signalHash,
      quoteHash: hashPayload(prepared.rawQuote),
      calldataHash: keccak256(prepared.transaction.data),
      nonce: state.nonce,
    };
    const risk = privateKeyToAccount(
      this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY as Hex,
    );
    const signature = await risk.signTypedData({
      domain: {
        name: "EQLTY",
        version: "1",
        chainId: 4663,
        verifyingContract: this.vault(),
      },
      types: eqltyExecutionTypes,
      primaryType: "Execution",
      message,
    });

    const rpcUrl = this.rpcUrl();
    const chain = robinhood(rpcUrl);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const trader = privateKeyToAccount(
      this.config.EQLTY_TRADER_PRIVATE_KEY as Hex,
    );
    const simulation = await publicClient.simulateContract({
      account: trader,
      address: this.vault(),
      abi: eqltyVaultAbi,
      functionName: "execute",
      args: [message, prepared.transaction.data, signature],
    });
    const wallet = createWalletClient({
      account: trader,
      chain,
      transport: http(rpcUrl),
    });
    const transactionHash = await wallet.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
    });
    if (receipt.status !== "success") {
      throw new Error(`EQLTY vault execution reverted: ${transactionHash}`);
    }

    return {
      transactionHash,
      requestId: prepared.requestId,
      routing: prepared.routing,
      quotedAmountOut: prepared.amountOut,
    };
  }

  private assertArmed(amountIn: string): void {
    if (!this.ready()) {
      throw new Error("Live contract execution is not configured");
    }
    if (BigInt(amountIn) > BigInt(this.config.EQLTY_MAX_INPUT_AMOUNT)) {
      throw new Error("Purchase exceeds the mainnet execution cap");
    }
  }

  private async assertOnchainStrategy(
    strategy: ExecutionStrategy,
    amountIn: string,
  ): Promise<{ nonce: bigint }> {
    const rpcUrl = this.rpcUrl();
    const publicClient = createPublicClient({
      chain: robinhood(rpcUrl),
      transport: http(rpcUrl),
    });
    if ((await publicClient.getChainId()) !== 4663) {
      throw new Error("Execution RPC is not Robinhood Chain");
    }
    const code = await publicClient.getCode({ address: this.vault() });
    if (!code || code === "0x") {
      throw new Error("EQLTY vault bytecode is missing");
    }
    const strategyId = this.strategyId();
    const [stored, available, nonce, riskSigner, tokenSpender] =
      await Promise.all([
        publicClient.readContract({
          address: this.vault(),
          abi: eqltyVaultAbi,
          functionName: "strategies",
          args: [strategyId],
        }),
        publicClient.readContract({
          address: this.vault(),
          abi: eqltyVaultAbi,
          functionName: "availableBalance",
          args: [strategyId],
        }),
        publicClient.readContract({
          address: this.vault(),
          abi: eqltyVaultAbi,
          functionName: "executionNonce",
          args: [strategyId],
        }),
        publicClient.readContract({
          address: this.vault(),
          abi: eqltyVaultAbi,
          functionName: "RISK_SIGNER",
        }),
        publicClient.readContract({
          address: this.vault(),
          abi: eqltyVaultAbi,
          functionName: "TOKEN_SPENDER",
        }),
      ]);
    const trader = privateKeyToAccount(
      this.config.EQLTY_TRADER_PRIVATE_KEY as Hex,
    );
    const risk = privateKeyToAccount(
      this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY as Hex,
    );
    const expected = [
      [stored[0], strategy.owner, "owner"],
      [stored[1], trader.address, "agent"],
      [stored[2], strategy.inputToken, "input token"],
      [stored[3], strategy.outputToken, "output token"],
      [stored[4], strategy.router, "router"],
      [riskSigner, risk.address, "risk signer"],
      [
        tokenSpender,
        this.config.UNISWAP_PERMIT2_ADDRESS,
        "Permit2 spender",
      ],
    ] as const;
    for (const [actual, wanted, label] of expected) {
      if (getAddress(actual) !== getAddress(wanted)) {
        throw new Error(`EQLTY vault ${label} does not match`);
      }
    }
    if (
      stored[10] ||
      stored[11] ||
      stored[8] <= BigInt(Math.floor(Date.now() / 1_000))
    ) {
      throw new Error("EQLTY strategy is not active");
    }
    if (
      BigInt(amountIn) > stored[5] ||
      stored[7] + BigInt(amountIn) > stored[6] ||
      BigInt(amountIn) > available
    ) {
      throw new Error("EQLTY vault balance or limits block this purchase");
    }
    return { nonce };
  }

  private strategyId(): bigint {
    return BigInt(this.config.EQLTY_VAULT_STRATEGY_ID);
  }

  private vault(): Address {
    return this.config.EQLTY_VAULT_ADDRESS as Address;
  }

  private rpcUrl(): string {
    return this.config.ROBINHOOD_MAINNET_RPC_URL as string;
  }
}
