import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type {
  Request,
  Response as ExpressResponse,
} from "express";
import type { ApiConfig } from "./config.js";
import { fleetUserIdForWallet } from "./fleet-identity.js";
import type { EvmAddress } from "./market-types.js";

const userCookie = "eqlty_user_session";
const perkosCookie = "eqlty_perkos_session";

export type OwnerSession = {
  sub: string;
  provider: "wallet";
  walletAddress: EvmAddress;
  fleetUserId: string;
  expiresAt: string;
};

type PerkosSession = {
  ownerWallet: EvmAddress;
  idToken: string;
  expiresAt: string;
};

type Challenge = {
  nonce: string;
  message: string;
  expiresAt: number | string;
};

type Dependencies = {
  fetchFn?: typeof fetch;
  now?: () => number;
};

export class OwnerAuth {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  ready(): boolean {
    return Boolean(
      this.config.EQLTY_SESSION_SECRET &&
        this.config.PERKOS_FIREBASE_API_KEY,
    );
  }

  async challenge(address: EvmAddress): Promise<Challenge> {
    const response = await this.fetchFn(
      `${stripSlash(this.config.PERKOS_API_URL)}/auth/nonce?address=${encodeURIComponent(address.toLowerCase())}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = await jsonRecord(response);
    if (
      !response.ok ||
      typeof body.nonce !== "string" ||
      typeof body.message !== "string" ||
      !["number", "string"].includes(typeof body.expiresAt)
    ) {
      throw new Error(errorMessage(body, "PerkOS sign-in challenge failed"));
    }
    return {
      nonce: body.nonce,
      message: body.message,
      expiresAt: body.expiresAt as number | string,
    };
  }

  async verify(
    response: ExpressResponse,
    input: {
      address: EvmAddress;
      nonce: string;
      signature: `0x${string}`;
    },
  ): Promise<OwnerSession> {
    if (!this.ready()) {
      throw new Error("Owner authentication is not configured");
    }
    const ownerWallet = input.address.toLowerCase() as EvmAddress;
    const exchange = await this.fetchFn(
      `${stripSlash(this.config.PERKOS_API_URL)}/auth/wallet-signin`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          address: ownerWallet,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const exchangeBody = await jsonRecord(exchange);
    if (!exchange.ok || typeof exchangeBody.token !== "string") {
      throw new Error(
        errorMessage(exchangeBody, "PerkOS wallet sign-in failed"),
      );
    }

    const firebase = await this.firebaseSession(exchangeBody.token);
    const ttl = Math.min(
      positiveInteger(firebase.expiresIn, 3_600),
      this.config.SESSION_TTL_SECONDS,
    );
    const expiresAt = new Date(this.now() + ttl * 1_000).toISOString();
    const session: OwnerSession = {
      sub: `eip155:${this.config.ROBINHOOD_CHAIN_ID}:${ownerWallet}`,
      provider: "wallet",
      walletAddress: ownerWallet,
      fleetUserId: fleetUserIdForWallet(ownerWallet),
      expiresAt,
    };
    const infrastructure: PerkosSession = {
      ownerWallet,
      idToken: firebase.idToken,
      expiresAt,
    };

    response.setHeader("set-cookie", [
      this.cookie(userCookie, this.seal(session), ttl),
      this.cookie(perkosCookie, this.seal(infrastructure), ttl),
    ]);
    return session;
  }

  session(request: Request): OwnerSession | undefined {
    const token = parseCookies(request.headers.cookie)[userCookie];
    const session = this.unseal<OwnerSession>(token);
    if (
      !session ||
      session.provider !== "wallet" ||
      !isAddress(session.walletAddress) ||
      Date.parse(session.expiresAt) <= this.now()
    ) {
      return undefined;
    }
    return session;
  }

  perkosIdToken(request: Request): string | undefined {
    const user = this.session(request);
    const token = parseCookies(request.headers.cookie)[perkosCookie];
    const session = this.unseal<PerkosSession>(token);
    if (
      !user ||
      !session ||
      session.ownerWallet !== user.walletAddress ||
      Date.parse(session.expiresAt) <= this.now()
    ) {
      return undefined;
    }
    return session.idToken;
  }

  logout(response: ExpressResponse): void {
    response.setHeader("set-cookie", [
      this.cookie(userCookie, "", 0),
      this.cookie(perkosCookie, "", 0),
    ]);
  }

  private async firebaseSession(
    customToken: string,
  ): Promise<{ idToken: string; expiresIn: string }> {
    const apiKey = this.config.PERKOS_FIREBASE_API_KEY;
    if (!apiKey) {
      throw new Error("PerkOS Firebase access is not configured");
    }
    const response = await this.fetchFn(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = await jsonRecord(response);
    if (!response.ok || typeof body.idToken !== "string") {
      throw new Error(
        errorMessage(body, "PerkOS Firebase session exchange failed"),
      );
    }
    return {
      idToken: body.idToken,
      expiresIn:
        typeof body.expiresIn === "string" ? body.expiresIn : "3600",
    };
  }

  private cookie(name: string, value: string, maxAge: number): string {
    const secure = this.config.APP_ORIGIN.startsWith("https:");
    return [
      `${name}=${value}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${secure ? "None" : "Lax"}`,
      `Max-Age=${maxAge}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  private seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.cookieKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64url",
    );
  }

  private unseal<T>(token?: string): T | undefined {
    if (!token) return undefined;
    try {
      const packed = Buffer.from(token, "base64url");
      if (packed.length < 29) return undefined;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.cookieKey(),
        packed.subarray(0, 12),
      );
      decipher.setAuthTag(packed.subarray(12, 28));
      const decrypted = Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]);
      return JSON.parse(decrypted.toString("utf8")) as T;
    } catch {
      return undefined;
    }
  }

  private cookieKey(): Buffer {
    if (!this.config.EQLTY_SESSION_SECRET) {
      throw new Error("EQLTY_SESSION_SECRET is required");
    }
    return createHash("sha256")
      .update(`eqlty:owner-session:v1:${this.config.EQLTY_SESSION_SECRET}`)
      .digest();
  }
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [name, ...value] = part.trim().split("=");
      return [name, value.join("=")];
    }),
  );
}

async function jsonRecord(
  response: globalThis.Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function errorMessage(
  body: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  return fallback;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAddress(value: string): value is EvmAddress {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function stripSlash(value: string): string {
  return value.replace(/\/$/, "");
}
