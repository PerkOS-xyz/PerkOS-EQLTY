import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { fleetUserIdForWallet } from "./fleet-identity.js";
import { OwnerAuth } from "./owner-auth.js";

const address = "0x1234567890abcdef1234567890abcdef12345678" as const;
const signature = `0x${"ab".repeat(65)}` as const;
const now = Date.parse("2026-07-25T12:00:00.000Z");

describe("owner authentication", () => {
  it("proxies a PerkOS wallet challenge", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        nonce: "nonce-1",
        message: "Sign this message",
        expiresAt: now + 300_000,
      }),
    );
    const auth = new OwnerAuth(config(), { fetchFn, now: () => now });

    await expect(auth.challenge(address)).resolves.toEqual({
      nonce: "nonce-1",
      message: "Sign this message",
      expiresAt: now + 300_000,
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      `/auth/nonce?address=${address}`,
    );
  });

  it("creates encrypted owner and infrastructure sessions", async () => {
    const fetchFn = successfulExchange();
    const auth = new OwnerAuth(config(), { fetchFn, now: () => now });
    const output = responseCapture();

    const session = await auth.verify(output.response, {
      address: address.toUpperCase() as `0x${string}`,
      nonce: "nonce-1",
      signature,
    });
    const cookies = output.cookies();

    expect(session).toMatchObject({
      provider: "wallet",
      walletAddress: address,
      fleetUserId: fleetUserIdForWallet(address),
    });
    expect(cookies).toHaveLength(2);
    expect(cookies.join(";")).toContain("HttpOnly");
    expect(cookies.join(";")).not.toContain("firebase-id-token");

    const request = requestWithCookies(cookies);
    expect(auth.session(request)).toEqual(session);
    expect(auth.perkosIdToken(request)).toBe("firebase-id-token");
  });

  it("rejects a modified session cookie", async () => {
    const auth = new OwnerAuth(config(), {
      fetchFn: successfulExchange(),
      now: () => now,
    });
    const output = responseCapture();
    await auth.verify(output.response, {
      address,
      nonce: "nonce-1",
      signature,
    });
    const cookies = output.cookies();
    const modified = cookies.map((cookie, index) =>
      index === 0
        ? cookie.replace(
            /(eqlty_user_session=)(.)/,
            (_match, prefix: string, value: string) =>
              `${prefix}${value === "a" ? "b" : "a"}`,
          )
        : cookie,
    );

    expect(auth.session(requestWithCookies(modified))).toBeUndefined();
  });

  it("expires both sessions at the configured boundary", async () => {
    let clock = now;
    const auth = new OwnerAuth(config(), {
      fetchFn: successfulExchange(),
      now: () => clock,
    });
    const output = responseCapture();
    await auth.verify(output.response, {
      address,
      nonce: "nonce-1",
      signature,
    });
    const request = requestWithCookies(output.cookies());

    clock += 3_601_000;

    expect(auth.session(request)).toBeUndefined();
    expect(auth.perkosIdToken(request)).toBeUndefined();
  });

  it("clears every owner cookie on logout", () => {
    const auth = new OwnerAuth(config());
    const output = responseCapture();

    auth.logout(output.response);

    expect(output.cookies()).toHaveLength(2);
    expect(output.cookies().every((cookie) => cookie.includes("Max-Age=0")))
      .toBe(true);
  });

  it("requires server credentials before verification", async () => {
    const auth = new OwnerAuth(loadConfig({}));
    const output = responseCapture();

    await expect(
      auth.verify(output.response, {
        address,
        nonce: "nonce-1",
        signature,
      }),
    ).rejects.toThrow("Owner authentication is not configured");
  });
});

function config() {
  return loadConfig({
    EQLTY_SESSION_SECRET: "s".repeat(32),
    PERKOS_FIREBASE_API_KEY: "f".repeat(20),
  });
}

function successfulExchange() {
  return vi
    .fn()
    .mockResolvedValueOnce(Response.json({ token: "custom-token" }))
    .mockResolvedValueOnce(
      Response.json({
        idToken: "firebase-id-token",
        expiresIn: "3600",
      }),
    );
}

function responseCapture() {
  let values: string[] = [];
  const response = {
    setHeader(name: string, value: string | string[]) {
      if (name.toLowerCase() === "set-cookie") {
        values = Array.isArray(value) ? value : [value];
      }
      return this;
    },
  } as unknown as ExpressResponse;
  return {
    response,
    cookies: () => values,
  };
}

function requestWithCookies(cookies: string[]): ExpressRequest {
  return {
    headers: {
      cookie: cookies
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
  } as ExpressRequest;
}
