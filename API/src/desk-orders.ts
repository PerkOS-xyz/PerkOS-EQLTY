import type { ApiConfig } from "./config.js";
import type {
  DelegatedOrder,
  EqltyVaultExecutor,
} from "./eqlty-vault-executor.js";
import type { EvmAddress } from "./market-types.js";
import { hashPayload } from "./proof-handoff.js";

export class DeskOrderError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 409 | 503,
  ) {
    super(message);
    this.name = "DeskOrderError";
  }
}

type Dependencies = {
  executor: Pick<EqltyVaultExecutor, "prepareForAgent">;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

export type DeskPreparedOrder = DelegatedOrder & {
  owner: EvmAddress;
  agent: EvmAddress;
};

/**
 * Orders a PerkOS desk sends from the owner's delegated wallet. The owner
 * proves who they are with their PerkOS session; EQLTY checks that the
 * strategy is theirs and names that wallet as its agent, and returns the
 * quote, the route and the risk co-signature. PerkOS sends it only after the
 * owner approves it on the desk.
 */
export class DeskOrderService {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async prepare(input: {
    idToken: string;
    strategyId: string;
    amountIn: string;
    signal: string;
  }): Promise<DeskPreparedOrder> {
    const owner = await this.owner(input.idToken);
    const agent = await this.delegatedWallet(input.idToken);
    if (owner.toLowerCase() === agent.toLowerCase()) {
      throw new DeskOrderError(
        "The Trader's wallet must not be the wallet that owns the money",
        409,
      );
    }
    const signalHash = hashPayload({
      source: "perkos-desk",
      owner,
      strategyId: input.strategyId,
      amountIn: input.amountIn,
      signal: input.signal,
      at: this.now().toISOString(),
    });
    const order = await this.dependencies.executor.prepareForAgent({
      owner,
      agent,
      strategyId: input.strategyId,
      amountIn: input.amountIn,
      signalHash,
    });
    return { ...order, owner, agent };
  }

  /** The wallet behind a PerkOS session: Firebase knows the account, and PerkOS names each account by its wallet. */
  private async owner(idToken: string): Promise<EvmAddress> {
    const key = this.config.PERKOS_FIREBASE_API_KEY;
    if (!key) {
      throw new DeskOrderError("PerkOS sessions are not configured here", 503);
    }
    const response = await this.fetchFn(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      users?: Array<{ localId?: unknown }>;
    };
    const wallet = body.users?.[0]?.localId;
    if (
      !response.ok ||
      typeof wallet !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(wallet)
    ) {
      throw new DeskOrderError("Sign in to PerkOS again", 401);
    }
    return wallet.toLowerCase() as EvmAddress;
  }

  /** The wallet the owner delegated to the Trader, as PerkOS holds it. */
  private async delegatedWallet(idToken: string): Promise<EvmAddress> {
    const response = await this.fetchFn(
      `${this.config.PERKOS_API_URL.replace(/\/+$/, "")}/delegation/status`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${idToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 401) {
      throw new DeskOrderError("Sign in to PerkOS again", 401);
    }
    const body = (await response.json().catch(() => ({}))) as {
      delegated?: unknown;
      walletAddress?: unknown;
    };
    if (!response.ok) {
      throw new DeskOrderError("PerkOS did not answer about the Trader's wallet", 503);
    }
    if (
      body.delegated !== true ||
      typeof body.walletAddress !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(body.walletAddress)
    ) {
      throw new DeskOrderError(
        "Give the Trader access to a wallet of yours first",
        409,
      );
    }
    return body.walletAddress.toLowerCase() as EvmAddress;
  }
}
