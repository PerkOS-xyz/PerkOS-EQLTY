import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { DeskOrderError, DeskOrderService } from "./desk-orders.js";
import type { DelegatedOrder } from "./eqlty-vault-executor.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678" as const;
const trader = "0x6732c0829808e8286012f53462013104289025b4" as const;
const config = loadConfig({ PERKOS_FIREBASE_API_KEY: "firebase-web-key-for-tests" });

const order: DelegatedOrder = {
  vault: "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
  chainId: 4663,
  execution: {
    strategyId: "25",
    amountIn: "1000000",
    quotedAmountOut: "4200",
    minAmountOut: "4158",
    deadline: "1800000300",
    signalHash: `0x${"11".repeat(32)}`,
    quoteHash: `0x${"22".repeat(32)}`,
    calldataHash: `0x${"33".repeat(32)}`,
    nonce: "0",
  },
  routerCalldata: "0x3593564c",
  signature: "0xabcd",
  tokenOut: "0x00000000000000000000000000000000000000d4",
};

function fetchFor(input: { account?: string | null; delegation?: unknown; status?: number }) {
  return vi.fn<typeof fetch>(async (url) => {
    if (String(url).startsWith("https://identitytoolkit.googleapis.com/")) {
      return input.account === null
        ? new Response(JSON.stringify({ error: { message: "INVALID_ID_TOKEN" } }), { status: 400 })
        : new Response(JSON.stringify({ users: [{ localId: input.account ?? owner }] }));
    }
    return new Response(JSON.stringify(input.delegation ?? { delegated: true, walletAddress: trader }), {
      status: input.status ?? 200,
    });
  });
}

describe("desk orders from the owner's delegated wallet", () => {
  it("prepares an order for the owner's strategy with their delegated wallet as agent", async () => {
    const executor = { prepareForAgent: vi.fn(async () => order) };
    const fetchFn = fetchFor({});
    const service = new DeskOrderService(config, { executor, fetchFn, now: () => new Date("2026-09-26T00:00:00Z") });

    await expect(
      service.prepare({ idToken: "token", strategyId: "25", amountIn: "1000000", signal: "Buy $1 of AAPL: Risk GO" }),
    ).resolves.toMatchObject({ owner, agent: trader, routerCalldata: "0x3593564c" });
    expect(executor.prepareForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ owner, agent: trader, strategyId: "25", amountIn: "1000000" }),
    );
    const call = executor.prepareForAgent.mock.calls[0] as unknown as [{ signalHash: string }];
    expect(call[0].signalHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe("https://api.perkos.xyz/delegation/status");
    expect(new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer token");
  });

  it("asks to sign in again when the PerkOS session is not valid", async () => {
    const executor = { prepareForAgent: vi.fn(async () => order) };
    const service = new DeskOrderService(config, { executor, fetchFn: fetchFor({ account: null }) });
    await expect(service.prepare({ idToken: "bad", strategyId: "25", amountIn: "1", signal: "x" })).rejects.toMatchObject({ status: 401 });
    expect(executor.prepareForAgent).not.toHaveBeenCalled();
  });

  it("needs a delegated wallet, and never the owner's own", async () => {
    const executor = { prepareForAgent: vi.fn(async () => order) };
    const none = new DeskOrderService(config, { executor, fetchFn: fetchFor({ delegation: { delegated: false, walletAddress: null } }) });
    await expect(none.prepare({ idToken: "t", strategyId: "25", amountIn: "1", signal: "x" })).rejects.toThrow(/Give the Trader access/);
    const self = new DeskOrderService(config, { executor, fetchFn: fetchFor({ delegation: { delegated: true, walletAddress: owner } }) });
    await expect(self.prepare({ idToken: "t", strategyId: "25", amountIn: "1", signal: "x" })).rejects.toBeInstanceOf(DeskOrderError);
    expect(executor.prepareForAgent).not.toHaveBeenCalled();
  });
});
