import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  PreparedUniswapSwap,
  WalletSwapQuote,
} from "./market-types.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { UniswapClient } from "./uniswap-client.js";

type Dependencies = {
  catalog: Pick<StockCatalogService, "assessTicker">;
  uniswap?: Pick<
    UniswapClient,
    "buildWalletSell" | "prepareWalletSell"
  >;
  now?: () => Date;
};

export class WalletSwapService {
  private readonly uniswap: Pick<
    UniswapClient,
    "buildWalletSell" | "prepareWalletSell"
  >;
  private readonly now: () => Date;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.uniswap =
      dependencies.uniswap ?? new UniswapClient(config);
    this.now = dependencies.now ?? (() => new Date());
  }

  async quote(input: {
    owner: EvmAddress;
    ticker: string;
    tokenIn: EvmAddress;
    amountIn: string;
    maxSlippageBps: number;
  }): Promise<WalletSwapQuote> {
    const asset = await this.dependencies.catalog.assessTicker(
      input.ticker,
    );
    if (!asset || !same(asset.tokenAddress, input.tokenIn)) {
      throw new Error("Stock token does not match the market catalog");
    }
    if (!asset.uniswapRoutable) {
      throw new Error("This stock token has no observed Uniswap route");
    }
    return this.uniswap.prepareWalletSell({
      ticker: asset.ticker,
      tokenIn: asset.tokenAddress,
      amount: input.amountIn,
      swapper: input.owner,
      maxSlippageBps: input.maxSlippageBps,
    });
  }

  async build(input: {
    owner: EvmAddress;
    sell: WalletSwapQuote;
    signature?: `0x${string}`;
  }): Promise<PreparedUniswapSwap> {
    if (
      input.sell.chainId !== 4663 ||
      input.sell.direction !== "sell"
    ) {
      throw new Error("Wallet sale is not on Robinhood Chain");
    }
    if (!same(input.sell.tokenOut, this.config.INPUT_TOKEN_ADDRESS)) {
      throw new Error("Wallet sale output is not USDG");
    }
    const quoteAge = this.now().getTime() -
      Date.parse(input.sell.quotedAt);
    if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 60_000) {
      throw new Error("Uniswap quote expired; request a fresh quote");
    }
    const asset = await this.dependencies.catalog.assessTicker(
      input.sell.ticker,
    );
    if (!asset || !same(asset.tokenAddress, input.sell.tokenIn)) {
      throw new Error("Stock token does not match the market catalog");
    }
    return this.uniswap.buildWalletSell({
      sell: input.sell,
      swapper: input.owner,
      signature: input.signature,
    });
  }
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
