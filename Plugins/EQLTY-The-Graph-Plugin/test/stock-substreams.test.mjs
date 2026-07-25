import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../skills/robinhood-stock-substreams/scripts/stock-substreams.mjs";

const now = Date.parse("2026-07-25T12:00:00.000Z");
const transactionHash = `0x${"ab".repeat(32)}`;
const topic = `0x${"cd".repeat(32)}`;
const poolIdentifier = `0x${"ef".repeat(32)}`;

function evidence(overrides = {}) {
  return {
    source: "the-graph-substreams",
    ticker: "AMZN",
    chainId: "eip155:4663",
    protocol: "v4",
    blockNumber: "12345",
    liquidityUsd: 250_000,
    lastSwapPrice: 211.25,
    poolAddress: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    poolIdentifier,
    transactionHash,
    topic,
    capturedAt: "2026-07-25T11:59:30.000Z",
    stream: {
      mode: "live",
      provider: "robinhood.substreams.pinax.network:443",
      package: "eqlty_robinhood_stock_v4@v0.1.0",
      module: "map_pool_events",
      startedAt: "2026-07-25T11:00:00.000Z",
      updatedAt: "2026-07-25T11:59:45.000Z",
      checkpointBlock: "12345",
      processedBlock: "12345",
      providerHeadBlock: "12347",
      lagBlocks: 2,
    },
    health: {
      healthy: true,
      heartbeatAgeSeconds: 15,
      swapAgeSeconds: 30,
      reasons: [],
    },
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("lists the full observed pool catalog", async () => {
  const output = [];
  const exitCode = await runCli({
    argv: ["catalog"],
    write: (value) => output.push(value),
  });
  const catalog = JSON.parse(output[0]);

  assert.equal(exitCode, 0);
  assert.equal(catalog.chainId, 4663);
  assert.equal(catalog.count, 94);
  assert(catalog.tickers.includes("AMZN"));
  assert(catalog.tickers.includes("NVDA"));
});

test("resolves a ticker to its V4 pool", async () => {
  const output = [];
  await runCli({
    argv: ["pool", "amzn"],
    write: (value) => output.push(value),
  });
  const pool = JSON.parse(output[0]);

  assert.equal(pool.ticker, "AMZN");
  assert.match(pool.poolId, /^0x[0-9a-f]{64}$/);
  assert.equal(pool.chain, "eip155:4663");
});

test("normalizes authenticated live evidence", async () => {
  const output = [];
  let request;
  const exitCode = await runCli({
    argv: ["snapshot", "AMZN"],
    env: {
      EQLTY_AGENT_API_URL: "https://api.eqlty.example/",
      EQLTY_SESSION_COOKIE: "session=test-only",
    },
    now,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse(evidence());
    },
    write: (value) => output.push(value),
  });
  const snapshot = JSON.parse(output[0]);

  assert.equal(exitCode, 0);
  assert.equal(request.url, "https://api.eqlty.example/api/evidence/AMZN");
  assert.equal(request.init.headers.cookie, "session=test-only");
  assert.equal(snapshot.schema, "urn:eqlty:stock-substreams-agent:v1");
  assert.equal(snapshot.health.healthy, true);
  assert.equal(snapshot.evidence.transactionHash, transactionHash);
  assert.equal(snapshot.stream.providerHeadBlock, "12347");
});

test("fails closed when provider evidence is stale", async () => {
  const output = [];
  const exitCode = await runCli({
    argv: ["snapshot", "AMZN", "--max-heartbeat", "60"],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    now,
    fetchImpl: async () =>
      jsonResponse(evidence({
        stream: {
          ...evidence().stream,
          updatedAt: "2026-07-25T11:00:00.000Z",
        },
      })),
    write: (value) => output.push(value),
  });
  const snapshot = JSON.parse(output[0]);

  assert.equal(exitCode, 2);
  assert.equal(snapshot.health.healthy, false);
  assert.match(snapshot.health.reasons[0], /provider heartbeat/);
});

test("rejects evidence for a different ticker", async () => {
  await assert.rejects(
    runCli({
      argv: ["snapshot", "AMZN"],
      env: { EQLTY_SESSION_COOKIE: "session=test-only" },
      now,
      fetchImpl: async () => jsonResponse(evidence({ ticker: "NVDA" })),
    }),
    /ticker mismatch: expected AMZN, received NVDA/,
  );
});

test("requires an owner session for normalized evidence", async () => {
  await assert.rejects(
    runCli({
      argv: ["snapshot", "AMZN"],
      env: {},
      fetchImpl: async () => {
        throw new Error("request should not be sent");
      },
    }),
    /EQLTY_SESSION_COOKIE is required/,
  );
});

test("builds a ticker-bound direct stream command", async () => {
  const calls = [];
  const rawOutput = [];
  const spawnImpl = (executable, args, options) => {
    calls.push({ executable, args, options });
    return calls.length === 1
      ? { status: 0, stdout: "substreams 1.20.1", stderr: "" }
      : { status: 0, stdout: "{\"events\":[]}\n", stderr: "" };
  };
  const exitCode = await runCli({
    argv: ["stream", "AMZN", "--start", "-10", "--blocks", "10"],
    env: { SUBSTREAMS_API_TOKEN: "test-only-token" },
    spawnImpl,
    writeRaw: (value) => rawOutput.push(value),
  });

  assert.equal(exitCode, 0);
  assert.equal(calls[1].executable, "substreams");
  assert(calls[1].args.includes("map_pool_events"));
  const params = calls[1].args[calls[1].args.indexOf("--params") + 1];
  assert.match(params, /map_pool_events=v3=;v4=.*=AMZN$/);
  assert(!calls[1].args.join(" ").includes("test-only-token"));
  assert.equal(rawOutput[0], "{\"events\":[]}\n");
});

test("requires a Graph token for direct streaming", async () => {
  await assert.rejects(
    runCli({
      argv: ["stream", "AMZN"],
      env: {},
      spawnImpl: () => {
        throw new Error("process should not start");
      },
    }),
    /SUBSTREAMS_API_TOKEN is required/,
  );
});
