#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_API_URL = "http://localhost:4021";
const LIVE_CONFIRMATION = "ROBINHOOD_MAINNET";

function usage() {
  return [
    "Usage:",
    "  uniswap-agent.mjs catalog [ticker]",
    "  uniswap-agent.mjs run <strategy-id> <atomic-usdg>",
    `  uniswap-agent.mjs run <strategy-id> <atomic-usdg> --execute --confirm=${LIVE_CONFIRMATION}`,
  ].join("\n");
}

function apiUrl(value) {
  const parsed = new URL(value || DEFAULT_API_URL);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("EQLTY_AGENT_API_URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

function explorerUrl(hash) {
  return hash
    ? `https://robinhoodchain.blockscout.com/tx/${hash}`
    : undefined;
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`EQLTY API returned a non-JSON response (${response.status})`);
  }
}

function errorMessage(body) {
  if (body && typeof body === "object") {
    return body.message ?? body.error ?? JSON.stringify(body);
  }
  return String(body);
}

export async function runCli({
  argv,
  env = process.env,
  fetchImpl = fetch,
  write = (value) => console.log(value),
}) {
  const baseUrl = apiUrl(env.EQLTY_AGENT_API_URL);
  const sessionCookie = env.EQLTY_SESSION_COOKIE;
  const [command = "help", ...args] = argv;

  async function request(path, init = {}, authenticated = false) {
    if (authenticated && !sessionCookie) {
      throw new Error(
        "EQLTY_SESSION_COOKIE is required for this authenticated command",
      );
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(authenticated ? { cookie: sessionCookie } : {}),
        ...init.headers,
      },
    });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(`${response.status}: ${errorMessage(body)}`);
    }
    return body;
  }

  if (command === "catalog") {
    const ticker = args[0]?.trim().toUpperCase();
    const catalog = await request("/api/assets?catalog=uniswap-v4-universe");
    const assets = ticker
      ? catalog.assets.filter((asset) => asset.ticker === ticker)
      : catalog.assets;
    write(
      JSON.stringify(
        {
          observedAt: catalog.observedAt,
          summary: catalog.summary,
          assets,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "run") {
    const strategyId = args[0];
    const amountIn = args[1];
    const execute = args.includes("--execute");
    const confirmation = args
      .find((value) => value.startsWith("--confirm="))
      ?.split("=")[1];

    if (!strategyId || !/^[1-9]\d*$/.test(amountIn ?? "")) {
      throw new Error(usage());
    }
    if (execute && confirmation !== LIVE_CONFIRMATION) {
      throw new Error(
        `Live execution requires --confirm=${LIVE_CONFIRMATION}`,
      );
    }

    const run = await request(
      "/api/runs",
      {
        method: "POST",
        body: JSON.stringify({ strategyId, amountIn, execute }),
      },
      true,
    );
    write(
      JSON.stringify(
        {
          ...run,
          uniswapRequestId: run.quote?.requestId,
          transactionExplorerUrl: explorerUrl(run.transactionHash),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    write(usage());
    return;
  }

  throw new Error(usage());
}

const launchedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  runCli({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
