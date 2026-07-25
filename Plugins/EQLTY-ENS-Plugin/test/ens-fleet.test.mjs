import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../skills/ens-agent-fleet/scripts/ens-fleet.mjs";

const roles = ["scout", "risk", "trader", "auditor"];
const rootName = "u-12345678.demo.eth";
const manifestHash = `0x${"ab".repeat(32)}`;

function controlPlane(overrides = {}) {
  return {
    source: "durin",
    mode: "live",
    status: "active",
    rootName,
    manifestHash,
    manifest: {
      version: 3,
      paused: false,
      policy: {
        allowedTickers: ["NVDA", "AMZN", "AMD", "NFLX", "PLTR", "TSLA"],
        maxAmountPerTrade: "1000000",
        maxDeviationBps: 300,
        minLiquidityUsd: 50_000,
        maxOracleAgeSeconds: 86_400,
      },
      agentSettings: Object.fromEntries(
        roles.map((role, index) => [
          role,
          {
            name: `${role}.${rootName}`,
            recordKey: "agent-context",
            hash: `0x${String(index + 1).repeat(64)}`,
          },
        ]),
      ),
    },
    ...overrides,
  };
}

function metadata(role) {
  return {
    schema: "urn:eqlty:ens-agent-metadata:v1",
    role,
    rootName,
    manifestHash,
    name: `${role}.${rootName}`,
    settings: { role },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("shows the active ENS policy", async () => {
  const output = [];
  let request;
  await runCli({
    argv: ["policy"],
    env: {
      EQLTY_AGENT_API_URL: "https://api.eqlty.example/",
      EQLTY_SESSION_COOKIE: "session=test-only",
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse(controlPlane());
    },
    write: (value) => output.push(value),
  });

  assert.equal(request.url, "https://api.eqlty.example/api/orchestration");
  assert.equal(request.init.headers.cookie, "session=test-only");
  assert.equal(JSON.parse(output[0]).manifest.version, 3);
});

test("builds a hash-bound four-role directory", async () => {
  const output = [];
  const calls = [];
  await runCli({
    argv: ["directory"],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/api/orchestration")) {
        return jsonResponse(controlPlane());
      }
      const role = roles.find((candidate) => url.endsWith(`/${candidate}`));
      return jsonResponse(metadata(role));
    },
    write: (value) => output.push(value),
  });
  const directory = JSON.parse(output[0]);

  assert.equal(calls.length, 5);
  assert.equal(directory.schema, "urn:eqlty:ens-fleet-directory:v1");
  assert.equal(directory.manifestHash, manifestHash);
  assert.deepEqual(Object.keys(directory.roles), roles);
  assert.equal(
    directory.roles.trader.metadataUrl,
    "http://localhost:4021/api/fleet/metadata/trader",
  );
});

test("reads one role metadata record", async () => {
  const output = [];
  let path;
  await runCli({
    argv: ["metadata", "TRADER"],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    fetchImpl: async (url) => {
      path = url;
      return jsonResponse(metadata("trader"));
    },
    write: (value) => output.push(value),
  });

  assert.equal(path, "http://localhost:4021/api/fleet/metadata/trader");
  assert.equal(JSON.parse(output[0]).role, "trader");
});

test("prepares an emergency stop without adding API fields", async () => {
  const output = [];
  const calls = [];
  await runCli({
    argv: ["prepare", "emergency-stop"],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/api/orchestration")) {
        return jsonResponse(controlPlane());
      }
      return jsonResponse({
        rootName,
        currentManifestHash: manifestHash,
        manifestHash: `0x${"cd".repeat(32)}`,
        manifest: { version: 4 },
        publicationMode: "prepared-only",
        requiredAuthorization: ["owner-wallet", "world-selfie"],
        diff: [{ field: "paused", before: false, after: true }],
        agentRecords: Object.fromEntries(
          roles.map((role) => [
            role,
            {
              name: `${role}.${rootName}`,
              settingsHash: `0x${"ef".repeat(32)}`,
            },
          ]),
        ),
      });
    },
    write: (value) => output.push(value),
  });
  const body = JSON.parse(calls[1].init.body);
  const prepared = JSON.parse(output[0]);

  assert.equal(body.paused, true);
  assert.equal("version" in body, false);
  assert.deepEqual(body.allowedTickers, controlPlane().manifest.policy.allowedTickers);
  assert.equal(prepared.publicationMode, "prepared-only");
  assert.deepEqual(prepared.requiredAuthorization, [
    "owner-wallet",
    "world-selfie",
  ]);
});

test("preserves the complete ticker policy in opportunity mode", async () => {
  let body;
  await runCli({
    argv: ["prepare", "opportunity-mode"],
    env: { EQLTY_SESSION_COOKIE: "session=test-only" },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/orchestration")) {
        return jsonResponse(controlPlane());
      }
      body = JSON.parse(init.body);
      return jsonResponse({
        rootName,
        currentManifestHash: manifestHash,
        manifestHash: `0x${"cd".repeat(32)}`,
        manifest: { version: 4 },
        publicationMode: "prepared-only",
        requiredAuthorization: ["owner-wallet", "world-selfie"],
        diff: [],
        agentRecords: Object.fromEntries(
          roles.map((role) => [
            role,
            {
              name: `${role}.${rootName}`,
              settingsHash: `0x${"ef".repeat(32)}`,
            },
          ]),
        ),
      });
    },
    write: () => undefined,
  });

  assert.deepEqual(body.allowedTickers, controlPlane().manifest.policy.allowedTickers);
});

test("fails closed for inactive ENS records", async () => {
  await assert.rejects(
    runCli({
      argv: ["policy"],
      env: { EQLTY_SESSION_COOKIE: "session=test-only" },
      fetchImpl: async () =>
        jsonResponse(
          controlPlane({
            status: "invalid",
            error: "The fleet manifest hash does not match",
          }),
        ),
    }),
    /manifest hash does not match/,
  );
});

test("requires an owner session before calling the API", async () => {
  await assert.rejects(
    runCli({
      argv: ["directory"],
      env: {},
      fetchImpl: async () => {
        throw new Error("request should not be sent");
      },
    }),
    /EQLTY_SESSION_COOKIE is required/,
  );
});

test("rejects unsupported API URL protocols", async () => {
  await assert.rejects(
    runCli({
      argv: ["policy"],
      env: {
        EQLTY_AGENT_API_URL: "file:///tmp/api",
        EQLTY_SESSION_COOKIE: "session=test-only",
      },
    }),
    /must use http or https/,
  );
});
