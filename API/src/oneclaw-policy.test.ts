import { describe, expect, it } from "vitest";
import { oneClawGate } from "./oneclaw-policy.js";

const requiredRoles = ["trader"] as const;

describe("1Claw purchase policy", () => {
  it("allows amounts below 3 USDG without linked rails", () => {
    expect(
      oneClawGate({
        amountIn: "2999999",
        linkedRoles: [],
        requiredRoles,
      }),
    ).toMatchObject({
      required: false,
      linked: false,
      executionAuthorized: true,
    });
  });

  it("locks exactly 3 USDG until the trader rail is linked", () => {
    expect(
      oneClawGate({
        amountIn: "3000000",
        linkedRoles: [],
        requiredRoles,
      }),
    ).toMatchObject({
      required: true,
      linked: false,
      executionAuthorized: false,
    });
  });

  it("keeps linked purchases fail-closed until live authorization is enabled", () => {
    expect(
      oneClawGate({
        amountIn: "5000000",
        linkedRoles: requiredRoles,
        requiredRoles,
      }),
    ).toMatchObject({
      required: true,
      linked: true,
      executionAuthorized: false,
    });
  });

  it("allows purchases from 3 USDG only with linked live authorization", () => {
    expect(
      oneClawGate({
        amountIn: "5000000",
        linkedRoles: requiredRoles,
        requiredRoles,
        liveAuthorization: true,
      }),
    ).toMatchObject({
      required: true,
      linked: true,
      executionAuthorized: true,
    });
  });
});
