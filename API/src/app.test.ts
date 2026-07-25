import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("API foundation", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({});

    expect(config.PUBLIC_PROJECT_NAME).toBe("EQLTY");
    expect(config.ROBINHOOD_CHAIN_ID).toBe(4663);
    expect(config.DEMO_MODE).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(
      "Invalid API configuration",
    );
  });

  it("reports health without caching", async () => {
    const response = await request("/health");
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      mode: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      service: "eqlty-api",
      mode: "preview",
    });
  });

  it("only exposes public configuration", async () => {
    const response = await request("/api/config");
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.projectName).toBe("EQLTY");
    expect(serialized).not.toMatch(/key|secret|token|rpcUrl/i);
  });

  it("uses a consistent missing route response", async () => {
    const response = await request("/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("serves the stock catalog contract", async () => {
    const catalog = {
      chainId: 4663 as const,
      quoteToken: "USDG" as const,
      quoteAmount: "1000000",
      observedAt: "2026-07-25T12:00:00.000Z",
      thresholds: {
        availableDeviationBps: 100,
        maxDeviationBps: 300,
        maxReferenceAgeSeconds: 86_400,
      },
      summary: {
        total: 0,
        available: 0,
        caution: 0,
        blocked: 0,
        routed: 0,
        orchestrationReady: 0,
      },
      assets: [],
    };
    const response = await request(
      "/api/assets?catalog=uniswap-v4-universe",
      {
        stockCatalog: {
          catalog: async () => catalog,
          assessTicker: async () => undefined,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(catalog);
  });
});

async function request(
  path: string,
  dependencies?: Parameters<typeof createApp>[1],
): Promise<Response> {
  const server = createServer(createApp(loadConfig({}), dependencies));
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}
