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
      amount: "0.5",
      symbol: "USDG",
      network: "eip155:4663",
      requirements: {
        network: "robinhood",
        maxAmountRequired: "500000",
        payTo,
        asset,
      },
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      network: "robinhood",
      amount: 0.5,
    });
  });

  it("uses the PerkOS login shortfall for a new wallet", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      fundingChallenge("300000"),
    );
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    await expect(service.quote(0.3)).resolves.toMatchObject({
      amount: "0.3",
      requirements: { maxAmountRequired: "300000" },
    });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      network: "robinhood",
      amount: 0.3,
    });
  });

  it("reports the prepaid runway for the four-agent fleet", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Response.json({
        creditsUsd: 0.5,
        enrolled: true,
        exempt: false,
        infra: {
          allowed: true,
          hoursRemaining: 10 / 3,
          rateUsdPerTeamHour: 0.15,
        },
        generatedAt: "2026-09-03T08:30:00.000Z",
      }),
    );
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    await expect(service.status("firebase-token")).resolves.toEqual({
      creditsUsd: 0.5,
      estimatedFleetMinutes: 50,
      rateUsdPerActiveAgentHour: 0.15,
      state: "funded",
      updatedAt: "2026-09-03T08:30:00.000Z",
    });
    expect(
      new Headers(fetchFn.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer firebase-token");
  });

  it("keeps sponsored compute distinct from prepaid balances", async () => {
    const service = new PerkosFundingService(loadConfig({}), {
      fetchFn: vi.fn(async () =>
        Response.json({
          creditsUsd: 0,
          enrolled: true,
          exempt: true,
          infra: {
            allowed: true,
            hoursRemaining: null,
            rateUsdPerTeamHour: 0.15,
          },
        }),
      ),
    });

    await expect(service.status("firebase-token")).resolves.toMatchObject({
      estimatedFleetMinutes: null,
      state: "sponsored",
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
          creditsUsd: 0.5,
          deposited: 0.5,
          network: "robinhood",
          transaction: `0x${"ab".repeat(32)}`,
        }),
      );
    const service = new PerkosFundingService(loadConfig({}), { fetchFn });

    const receipt = await service.settle(owner, payment());

    expect(receipt.creditsUsd).toBe(0.5);
    const header = new Headers(fetchFn.mock.calls[1]?.[1]?.headers).get(
      "payment-signature",
    );
    expect(
      JSON.parse(Buffer.from(header!, "base64").toString("utf8")),
    ).toMatchObject({
      x402Version: 1,
      network: "robinhood",
      payload: { authorization: { from: owner, value: "500000" } },
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
          creditsUsd: 0.5,
          deposited: 0.5,
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

function fundingChallenge(maxAmountRequired = "500000"): Response {
  return Response.json(
    {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "robinhood",
          maxAmountRequired,
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
        value: "500000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1_000) + 120),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}
