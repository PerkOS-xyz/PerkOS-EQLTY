#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(skillDir, "assets/pool-registry.json");
const packagePath = resolve(
  skillDir,
  "assets/eqlty-robinhood-stock-v4-v0.1.0.spkg",
);
const defaultApiUrl = "http://localhost:4021";
const defaultProvider = "robinhood.substreams.pinax.network:443";
const registry = JSON.parse(await readFile(registryPath, "utf8"));

function usage() {
  return [
    "Usage:",
    "  stock-substreams.mjs catalog",
    "  stock-substreams.mjs pool <ticker>",
    "  stock-substreams.mjs snapshot <ticker> [--endpoint URL] [--max-heartbeat N] [--max-swap-age N] [--max-lag N]",
    "  stock-substreams.mjs stream <ticker> [--provider HOST] [--start BLOCK] [--blocks N] [--bin PATH]",
  ].join("\n");
}

function parseFlags(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requireTicker(value) {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker)) {
    throw new Error("ticker must contain 1-12 supported symbol characters");
  }
  return ticker;
}

function poolRecord(ticker) {
  const asset = registry.assets[ticker];
  if (!asset) {
    throw new Error(`${ticker} has no observed Uniswap V4 Stock Token pool`);
  }
  return {
    schema: registry.schema,
    observedAt: registry.observedAt,
    ticker,
    chain: `eip155:${registry.chainId}`,
    chainId: registry.chainId,
    quoteToken: registry.quoteToken,
    poolManager: registry.poolManager,
    ...asset,
  };
}

function endpoint(value) {
  const parsed = new URL(value || defaultApiUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Graph adapter endpoint must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Graph adapter returned non-JSON (${response.status})`);
  }
}

function validateSnapshot(body, ticker) {
  if (body.source !== "the-graph-substreams") {
    throw new Error("response is not The Graph Substreams evidence");
  }
  if (body.ticker !== ticker) {
    throw new Error(`ticker mismatch: expected ${ticker}, received ${body.ticker}`);
  }
  if (body.chainId !== "eip155:4663") {
    throw new Error(`unexpected chain: ${body.chainId}`);
  }
  if (
    body.stream?.mode !== "live" ||
    !body.stream.provider ||
    !body.stream.package
  ) {
    throw new Error("response has no live Graph provider provenance");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(body.transactionHash ?? "")) {
    throw new Error("response has no canonical transaction hash");
  }
  if (!Number.isFinite(body.lastSwapPrice) || body.lastSwapPrice <= 0) {
    throw new Error("response has no positive Swap price");
  }
  if (!Number.isFinite(body.liquidityUsd) || body.liquidityUsd <= 0) {
    throw new Error("response has no positive liquidity");
  }
}

function ageSeconds(timestamp, now) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / 1_000);
}

function positiveNumber(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("threshold must be positive");
  }
  return parsed;
}

function nonnegativeInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("value must be a non-negative integer");
  }
  return parsed;
}

async function snapshot({
  ticker,
  flags,
  env,
  fetchImpl,
  now,
}) {
  if (!env.EQLTY_SESSION_COOKIE) {
    throw new Error("EQLTY_SESSION_COOKIE is required for normalized evidence");
  }
  const baseUrl = endpoint(flags.endpoint ?? env.EQLTY_AGENT_API_URL);
  const response = await fetchImpl(
    `${baseUrl}/api/evidence/${encodeURIComponent(ticker)}`,
    {
      headers: {
        accept: "application/json",
        cookie: env.EQLTY_SESSION_COOKIE,
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    throw new Error(
      `Graph adapter returned ${response.status}: ${body.message ?? body.error ?? "unknown error"}`,
    );
  }
  validateSnapshot(body, ticker);

  const heartbeatAgeSeconds = ageSeconds(body.stream.updatedAt, now);
  const swapAgeSeconds = ageSeconds(body.capturedAt, now);
  const maxHeartbeat = positiveNumber(flags["max-heartbeat"], 3_600);
  const maxSwapAge = positiveNumber(flags["max-swap-age"], 86_400);
  const maxLag = nonnegativeInteger(flags["max-lag"], 20);
  const reasons = [];
  if (heartbeatAgeSeconds > maxHeartbeat) {
    reasons.push(`provider heartbeat is ${Math.round(heartbeatAgeSeconds)}s old`);
  }
  if (swapAgeSeconds > maxSwapAge) {
    reasons.push(`last swap is ${Math.round(swapAgeSeconds)}s old`);
  }
  if (body.stream.lagBlocks > maxLag) {
    reasons.push(`provider lag is ${body.stream.lagBlocks} blocks`);
  }
  if (body.health?.healthy === false) {
    reasons.push(
      ...(body.health.reasons ?? ["adapter marked the stream unhealthy"]),
    );
  }

  return {
    schema: "urn:eqlty:stock-substreams-agent:v1",
    ticker,
    chainId: body.chainId,
    market: {
      protocol: body.protocol,
      lastSwapPrice: body.lastSwapPrice,
      liquidityUsd: body.liquidityUsd,
    },
    evidence: {
      blockNumber: body.blockNumber,
      transactionHash: body.transactionHash,
      poolAddress: body.poolAddress,
      poolIdentifier: body.poolIdentifier,
      topic: body.topic,
      capturedAt: body.capturedAt,
    },
    stream: {
      provider: body.stream.provider,
      package: body.stream.package,
      module: body.stream.module,
      processedBlock: body.stream.processedBlock,
      providerHeadBlock: body.stream.providerHeadBlock,
      lagBlocks: body.stream.lagBlocks,
      updatedAt: body.stream.updatedAt,
    },
    health: {
      healthy: reasons.length === 0,
      heartbeatAgeSeconds,
      swapAgeSeconds,
      limits: { maxHeartbeat, maxSwapAge, maxLag },
      reasons: [...new Set(reasons)],
    },
  };
}

function stream({
  ticker,
  flags,
  env,
  spawnImpl,
  writeRaw,
  writeError,
}) {
  if (!env.SUBSTREAMS_API_TOKEN) {
    throw new Error("SUBSTREAMS_API_TOKEN is required for direct streaming");
  }
  const executable = String(flags.bin ?? "substreams");
  const probe = spawnImpl(executable, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `Substreams CLI is unavailable: ${probe.error?.message ?? probe.stderr}`,
    );
  }
  const pool = poolRecord(ticker);
  const startBlock = String(flags.start ?? "-500");
  if (!/^(?:-\d+|\d+)$/.test(startBlock)) {
    throw new Error("--start must be an absolute or negative relative block");
  }
  const blocks = nonnegativeInteger(flags.blocks, 500);
  const provider = String(flags.provider ?? defaultProvider);
  const parameter =
    `map_pool_events=v3=;v4=${pool.poolManager}:${pool.poolId}=${ticker}`;
  const positiveStart = /^\d+$/.test(startBlock);
  const result = spawnImpl(
    executable,
    [
      "run",
      "-e",
      provider,
      packagePath,
      "map_pool_events",
      "--start-block",
      startBlock,
      "--stop-block",
      positiveStart ? `+${blocks}` : "0",
      "--limit-processed-blocks",
      positiveStart ? "0" : String(blocks + 1),
      "--output",
      "jsonl",
      "--params",
      parameter,
    ],
    {
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.stdout) writeRaw(result.stdout);
  if (result.stderr) writeError(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Substreams exited with status ${result.status}`);
  }
}

export async function runCli({
  argv,
  env = process.env,
  fetchImpl = fetch,
  spawnImpl = spawnSync,
  now = Date.now(),
  write = (value) => process.stdout.write(`${value}\n`),
  writeRaw = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value),
}) {
  const [command = "help", tickerArgument, ...rest] = argv;
  const flags = parseFlags(rest);

  if (command === "help" || command === "--help" || command === "-h") {
    write(usage());
    return 0;
  }
  if (command === "catalog") {
    write(JSON.stringify({
      schema: registry.schema,
      observedAt: registry.observedAt,
      chain: `eip155:${registry.chainId}`,
      chainId: registry.chainId,
      poolManager: registry.poolManager,
      count: Object.keys(registry.assets).length,
      tickers: Object.keys(registry.assets).sort(),
    }, null, 2));
    return 0;
  }

  const ticker = requireTicker(tickerArgument);
  if (command === "pool") {
    write(JSON.stringify(poolRecord(ticker), null, 2));
    return 0;
  }
  if (command === "snapshot") {
    const result = await snapshot({ ticker, flags, env, fetchImpl, now });
    write(JSON.stringify(result, null, 2));
    return result.health.healthy ? 0 : 2;
  }
  if (command === "stream") {
    stream({ ticker, flags, env, spawnImpl, writeRaw, writeError });
    return 0;
  }
  throw new Error(usage());
}

const launchedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  runCli({ argv: process.argv.slice(2) })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({
        schema: "urn:eqlty:stock-substreams-error:v1",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
