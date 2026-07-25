import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../skills/execute-stock-token-trade/scripts/uniswap-agent.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("filters the live catalog by ticker", async () => {
  const output = [];
  const calls = [];
  await runCli({
    argv: ["catalog", "amzn"],
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        observedAt: "2026-07-25T12:00:00.000Z",
        summary: { total: 2, tradable: 2 },
        assets: [
          { ticker: "AMZN", status: "tradeable" },
          { ticker: "NVDA", status: "tradeable" },
        ],
      });
    },
    write: (value) => output.push(value),
  });

  assert.equal(
    calls[0].url,
    "http://localhost:4021/api/assets?catalog=uniswap-v4-universe",
  );
  assert.deepEqual(JSON.parse(output[0]).assets, [
    { ticker: "AMZN", status: "tradeable" },
  ]);
});

test("submits an authenticated dry run", async () => {
  const output = [];
  let request;
  await runCli({
    argv: ["run", "strategy-one", "1000000"],
    env: {
      EQLTY_AGENT_API_URL: "https://api.eqlty.example/",
      EQLTY_SESSION_COOKIE: "session=test-only",
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        id: "run-one",
        status: "approved",
        quote: { requestId: "quote-one" },
      }, 201);
    },
    write: (value) => output.push(value),
  });

  assert.equal(request.url, "https://api.eqlty.example/api/runs");
  assert.equal(request.init.headers.cookie, "session=test-only");
  assert.deepEqual(JSON.parse(request.init.body), {
    strategyId: "strategy-one",
    amountIn: "1000000",
    execute: false,
  });
  assert.equal(JSON.parse(output[0]).uniswapRequestId, "quote-one");
});

test("prints an explorer URL for executed runs", async () => {
  const output = [];
  await runCli({
    argv: [
      "run",
      "strategy-one",
      "1000000",
      "--execute",
      "--confirm=ROBINHOOD_MAINNET",
    ],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    fetchImpl: async () =>
      jsonResponse({
        id: "run-two",
        status: "executed",
        transactionHash: "0xabc",
      }, 201),
    write: (value) => output.push(value),
  });

  assert.equal(
    JSON.parse(output[0]).transactionExplorerUrl,
    "https://robinhoodchain.blockscout.com/tx/0xabc",
  );
});

test("requires an authenticated owner session for runs", async () => {
  await assert.rejects(
    runCli({
      argv: ["run", "strategy-one", "1000000"],
      env: {},
      fetchImpl: async () => {
        throw new Error("request should not be sent");
      },
    }),
    /EQLTY_SESSION_COOKIE is required/,
  );
});

test("requires explicit mainnet confirmation", async () => {
  await assert.rejects(
    runCli({
      argv: ["run", "strategy-one", "1000000", "--execute"],
      env: { EQLTY_SESSION_COOKIE: "session=test-only" },
      fetchImpl: async () => {
        throw new Error("request should not be sent");
      },
    }),
    /Live execution requires --confirm=ROBINHOOD_MAINNET/,
  );
});

test("surfaces API errors without exposing session state", async () => {
  await assert.rejects(
    runCli({
      argv: ["run", "strategy-one", "1000000"],
      env: { EQLTY_SESSION_COOKIE: "session=test-only" },
      fetchImpl: async () =>
        jsonResponse({ error: "proof_run_failed" }, 503),
    }),
    /503: proof_run_failed/,
  );
});
