import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import {
  PerkosFundingService,
  type FleetFundingPayment,
} from "./perkos-funding.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678" as const;
const payTo = "0x3f0D7b9916212fA0A9Ac0EF8f72a25EB56F7046C" as const;
const asset = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;

describe("PerkOS fleet funding", () => {
  it("quotes the Robinhood USDG activation rail", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => fundingChallenge());
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    await expect(service.quote()).resolves.toMatchObject({
      amount: "0.1",
      symbol: "USDG",
      network: "eip155:4663",
      requirements: {
        network: "robinhood",
        maxAmountRequired: "100000",
        payTo,
        asset,
      },
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      network: "robinhood",
      amount: 0.1,
    });
  });

  it("settles and verifies the wallet credited by PerkOS", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fundingChallenge())
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          wallet: owner,
          creditsUsd: 0.1,
          deposited: 0.1,
          network: "robinhood",
          transaction: `0x${"ab".repeat(32)}`,
        }),
      );
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    const receipt = await service.settle(owner, payment());

    expect(receipt.creditsUsd).toBe(0.1);
    const header = new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get(
      "payment-signature",
    );
    expect(
      JSON.parse(Buffer.from(header!, "base64").toString("utf8")),
    ).toMatchObject({
      x402Version: 1,
      network: "robinhood",
      payload: { authorization: { from: owner, value: "100000" } },
    });
  });

  it("rejects a payment signed by another wallet", async () => {
    const service = new PerkosFundingService(loadConfig({}), {
      fetchFn: vi.fn(async () => fundingChallenge()),
    });
    const invalid = payment();
    invalid.payload.authorization.from =
      "0x9999999999999999999999999999999999999999";

    await expect(service.settle(owner, invalid)).rejects.toThrow(
      "does not match the quote",
    );
  });

  it("rejects a receipt credited to another wallet", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fundingChallenge())
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          wallet: "0x9999999999999999999999999999999999999999",
          creditsUsd: 0.1,
          deposited: 0.1,
          network: "robinhood",
          transaction: `0x${"ab".repeat(32)}`,
        }),
      );
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    await expect(service.settle(owner, payment())).rejects.toThrow(
      "credited a different wallet",
    );
  });
});

function fundingChallenge(): Response {
  return Response.json(
    {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "robinhood",
          maxAmountRequired: "100000",
          resource: "https://api.perkos.xyz/billing/deposit/x402",
          description: "PerkOS agent credits top-up",
          mimeType: "application/json",
          payTo,
          maxTimeoutSeconds: 120,
          asset,
          extra: { name: "Global Dollar", version: "1" },
        },
      ],
    },
    { status: 402 },
  );
}

function payment(): FleetFundingPayment {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "robinhood",
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: owner,
        to: payTo,
        value: "100000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1_000) + 120),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}
