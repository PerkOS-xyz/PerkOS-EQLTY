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
  executionAccountForStrategy,
  gasSponsorAccount,
} from "./execution-addresses.js";
import {
  eqltyExecutionTypes,
  eqltyVaultAbi,
} from "./eqlty-vault-abi.js";
import type { ExecutionStrategy, OnchainStrategy } from "./execution-types.js";
import type { EvmAddress, PreparedUniswapSwap } from "./market-types.js";
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

/** What the vault checks about a strategy before it lets an order through. */
type StrategyTerms = Pick<
  ExecutionStrategy,
  "owner" | "agent" | "inputToken" | "outputToken" | "router"
> & { onchain?: Pick<OnchainStrategy, "chainId" | "strategyId"> };

/** An order prepared for the owner's delegated wallet to send. */
export type DelegatedOrder = {
  vault: Address;
  chainId: 4663;
  execution: {
    strategyId: string;
    amountIn: string;
    quotedAmountOut: string;
    minAmountOut: string;
    deadline: string;
    signalHash: Hex;
    quoteHash: Hex;
    calldataHash: Hex;
    nonce: string;
  };
  routerCalldata: Hex;
  signature: Hex;
  tokenOut: EvmAddress;
  requestId?: string;
  routing?: string;
};

export class EqltyVaultExecutor implements TradeExecutor {
  private readonly uniswap: UniswapClient;

  constructor(
    private readonly config: ApiConfig,
    dependencies: { uniswap?: UniswapClient } = {},
  ) {
    this.uniswap = dependencies.uniswap ?? new UniswapClient(config);
  }

  ready(): boolean {
    const serverWalletReady =
      this.config.EQLTY_SERVER_WALLET_MODE === "shared"
        ? Boolean(this.config.EQLTY_TRADER_PRIVATE_KEY)
        : Boolean(
            this.config.EQLTY_SERVER_WALLET_MASTER_KEY ??
              this.config.EQLTY_TRADER_PRIVATE_KEY,
          ) &&
          Boolean(
            this.config.EQLTY_GAS_SPONSOR_PRIVATE_KEY ??
              this.config.EQLTY_TRADER_PRIVATE_KEY,
          );
    return Boolean(
      this.config.EQLTY_EXECUTION_MODE === "live" &&
        this.config.EQLTY_EXECUTION_CONFIRM === "ROBINHOOD_MAINNET" &&
        this.config.ROBINHOOD_CHAIN_ID === 4663 &&
        this.config.UNISWAP_CHAIN_ID === 4663 &&
        this.config.ROBINHOOD_MAINNET_RPC_URL &&
        this.config.EQLTY_VAULT_ADDRESS &&
        serverWalletReady &&
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

    const { message, signature } = await this.riskSigned(
      state,
      input.amountIn,
      input.strategy.maxSlippageBps,
      input.signalHash,
      prepared,
    );

    const rpcUrl = this.rpcUrl();
    const chain = robinhood(rpcUrl);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const trader = executionAccountForStrategy(
      this.config,
      input.strategy.owner,
      input.strategy.agent,
    );
    const gasSponsorshipTransactionHash =
      await this.ensureExecutionGas(publicClient, chain, trader);
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
      gasSponsorshipTransactionHash,
    };
  }

  private async ensureExecutionGas(
    publicClient: ReturnType<typeof createPublicClient>,
    chain: ReturnType<typeof robinhood>,
    trader: ReturnType<typeof privateKeyToAccount>,
  ): Promise<Hex | undefined> {
    const minimum = BigInt(
      this.config.EQLTY_SERVER_WALLET_MIN_GAS_WEI,
    );
    const target = BigInt(
      this.config.EQLTY_SERVER_WALLET_TARGET_GAS_WEI,
    );
    const balance = await publicClient.getBalance({
      address: trader.address,
    });
    if (balance >= minimum) return undefined;

    const sponsor = gasSponsorAccount(this.config);
    if (!sponsor) {
      throw new Error(
        "The Robinhood execution wallet needs gas sponsorship",
      );
    }
    if (sponsor.address.toLowerCase() === trader.address.toLowerCase()) {
      throw new Error(
        "The Robinhood execution wallet needs more gas",
      );
    }

    const value = gasTopUpAmount(balance, minimum, target);
    if (value === 0n) return undefined;
    const sponsorBalance = await publicClient.getBalance({
      address: sponsor.address,
    });
    if (sponsorBalance <= value) {
      throw new Error(
        "The EQLTY gas sponsor needs more Robinhood Chain ETH",
      );
    }

    const sponsorWallet = createWalletClient({
      account: sponsor,
      chain,
      transport: http(this.rpcUrl()),
    });
    const hash = await sponsorWallet.sendTransaction({
      to: trader.address,
      value,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("EQLTY gas sponsorship failed");
    }
    return hash;
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
    strategy: StrategyTerms,
    amountIn: string,
    agentAddress?: Address,
  ): Promise<{ nonce: bigint; strategyId: bigint }> {
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
    const strategyId = onchainStrategyId(strategy);
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
    // The agent is EQLTY's own execution wallet, unless the owner named their delegated wallet.
    const agent =
      agentAddress ??
      executionAccountForStrategy(
        this.config,
        strategy.owner,
        strategy.agent,
      ).address;
    const risk = privateKeyToAccount(
      this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY as Hex,
    );
    const expected = [
      [stored[0], strategy.owner, "owner"],
      [stored[1], agent, "agent"],
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
    return { nonce, strategyId };
  }

  /**
   * An order for a strategy whose agent is the owner's own delegated wallet:
   * the same quote, route and risk co-signature as a live execution, returned
   * unsent. PerkOS sends it from that wallet once the owner approves it.
   */
  async prepareForAgent(input: {
    owner: EvmAddress;
    agent: EvmAddress;
    strategyId: string;
    amountIn: string;
    signalHash: Hex;
  }): Promise<DelegatedOrder> {
    this.assertArmed(input.amountIn);
    const rpcUrl = this.rpcUrl();
    const publicClient = createPublicClient({
      chain: robinhood(rpcUrl),
      transport: http(rpcUrl),
    });
    const stored = await publicClient.readContract({
      address: this.vault(),
      abi: eqltyVaultAbi,
      functionName: "strategies",
      args: [BigInt(input.strategyId)],
    });
    const terms: StrategyTerms = {
      owner: input.owner,
      agent: input.agent,
      inputToken: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
      outputToken: getAddress(stored[3]) as EvmAddress,
      router: this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
      onchain: { chainId: 4663, strategyId: input.strategyId },
    };
    const state = await this.assertOnchainStrategy(
      terms,
      input.amountIn,
      input.agent,
    );
    const maxSlippageBps = Number(stored[9]);
    const prepared = await this.uniswap.prepareSwap({
      tokenOut: terms.outputToken,
      amount: input.amountIn,
      maxSlippageBps,
    });
    const { message, signature } = await this.riskSigned(
      state,
      input.amountIn,
      maxSlippageBps,
      input.signalHash,
      prepared,
    );
    return {
      vault: this.vault(),
      chainId: 4663,
      execution: {
        strategyId: message.strategyId.toString(),
        amountIn: message.amountIn.toString(),
        quotedAmountOut: message.quotedAmountOut.toString(),
        minAmountOut: message.minAmountOut.toString(),
        deadline: message.deadline.toString(),
        signalHash: message.signalHash,
        quoteHash: message.quoteHash,
        calldataHash: message.calldataHash,
        nonce: message.nonce.toString(),
      },
      routerCalldata: prepared.transaction.data,
      signature,
      tokenOut: terms.outputToken,
      requestId: prepared.requestId,
      routing: prepared.routing,
    };
  }

  /** The execution the vault will check, co-signed by the risk key. */
  private async riskSigned(
    state: { nonce: bigint; strategyId: bigint },
    amountIn: string,
    maxSlippageBps: number,
    signalHash: Hex,
    prepared: PreparedUniswapSwap,
  ) {
    const quotedAmountOut = BigInt(prepared.amountOut);
    const minAmountOut =
      (quotedAmountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
    const message = {
      strategyId: state.strategyId,
      amountIn: BigInt(amountIn),
      quotedAmountOut,
      minAmountOut,
      deadline: BigInt(Math.floor(Date.now() / 1_000) + 300),
      signalHash,
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
    return { message, signature };
  }

  private vault(): Address {
    return this.config.EQLTY_VAULT_ADDRESS as Address;
  }

  private rpcUrl(): string {
    return this.config.ROBINHOOD_MAINNET_RPC_URL as string;
  }
}

export function gasTopUpAmount(
  balance: bigint,
  minimum: bigint,
  target: bigint,
): bigint {
  if (target < minimum) {
    throw new Error("Gas target must cover the minimum");
  }
  return balance < minimum ? target - balance : 0n;
}

export function onchainStrategyId(strategy: {
  onchain?: Pick<OnchainStrategy, "chainId" | "strategyId">;
}): bigint {
  if (!strategy.onchain || strategy.onchain.chainId !== 4663) {
    throw new Error("Strategy is not funded on Robinhood Chain");
  }
  return BigInt(strategy.onchain.strategyId);
}
