#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_API_URL = "http://localhost:4021";
const roles = ["scout", "risk", "trader", "auditor"];

function usage() {
  return [
    "Usage:",
    "  ens-fleet.mjs directory",
    "  ens-fleet.mjs metadata <scout|risk|trader|auditor>",
    "  ens-fleet.mjs policy",
    "  ens-fleet.mjs prepare <capital-protection|opportunity-mode|emergency-stop>",
  ].join("\n");
}

function apiUrl(value) {
  const parsed = new URL(value || DEFAULT_API_URL);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("EQLTY_AGENT_API_URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `EQLTY API returned a non-JSON response (${response.status})`,
    );
  }
}

function errorMessage(body) {
  if (body && typeof body === "object") {
    return body.message ?? body.error ?? JSON.stringify(body);
  }
  return String(body);
}

function isHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function requireActive(controlPlane) {
  if (
    controlPlane?.source !== "durin" ||
    controlPlane?.mode !== "live" ||
    controlPlane?.status !== "active" ||
    !controlPlane.rootName ||
    !controlPlane.manifestHash ||
    !controlPlane.manifest
  ) {
    throw new Error(
      controlPlane?.error ?? "The live ENS control plane is not active",
    );
  }
  return controlPlane;
}

function preset(name, current) {
  const policy = current.manifest.policy;
  if (name === "emergency-stop") {
    return { paused: true, ...policy };
  }
  if (name === "capital-protection") {
    return {
      paused: false,
      allowedTickers: policy.allowedTickers,
      maxAmountPerTrade: "500000",
      maxDeviationBps: 100,
      minLiquidityUsd: 250_000,
      maxOracleAgeSeconds: 300,
    };
  }
  if (name === "opportunity-mode") {
    return {
      paused: false,
      allowedTickers: policy.allowedTickers,
      maxAmountPerTrade: "1000000",
      maxDeviationBps: 300,
      minLiquidityUsd: 50_000,
      maxOracleAgeSeconds: 86_400,
    };
  }
  throw new Error(usage());
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

  async function request(path, init = {}) {
    if (!sessionCookie) {
      throw new Error(
        "EQLTY_SESSION_COOKIE is required for ENS fleet commands",
      );
    }
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: sessionCookie,
        ...init.headers,
      },
    });
    const body = await responseBody(response);
    if (!response.ok) {
      throw new Error(`${response.status}: ${errorMessage(body)}`);
    }
    return body;
  }

  if (command === "policy") {
    write(JSON.stringify(requireActive(await request("/api/orchestration")), null, 2));
    return 0;
  }

  if (command === "metadata") {
    const role = args[0]?.toLowerCase();
    if (!roles.includes(role)) throw new Error(usage());
    const metadata = await request(`/api/fleet/metadata/${role}`);
    if (
      metadata?.schema !== "urn:eqlty:ens-agent-metadata:v1" ||
      metadata.role !== role
    ) {
      throw new Error(`The ${role} ENS metadata response is invalid`);
    }
    write(JSON.stringify(metadata, null, 2));
    return 0;
  }

  if (command === "directory") {
    const current = requireActive(await request("/api/orchestration"));
    const metadata = await Promise.all(
      roles.map((role) => request(`/api/fleet/metadata/${role}`)),
    );
    const entries = Object.fromEntries(
      metadata.map((record, index) => {
        const role = roles[index];
        const reference = current.manifest.agentSettings?.[role];
        if (
          record?.schema !== "urn:eqlty:ens-agent-metadata:v1" ||
          record.role !== role ||
          record.rootName !== current.rootName ||
          record.manifestHash !== current.manifestHash ||
          !reference ||
          record.name !== reference.name
        ) {
          throw new Error(`The ${role} ENS directory entry is invalid`);
        }
        return [
          role,
          {
            name: record.name,
            settingsHash: reference.hash,
            metadataUrl: `${baseUrl}/api/fleet/metadata/${role}`,
          },
        ];
      }),
    );
    write(
      JSON.stringify(
        {
          schema: "urn:eqlty:ens-fleet-directory:v1",
          source: current.source,
          mode: current.mode,
          status: current.status,
          rootName: current.rootName,
          manifestVersion: current.manifest.version,
          manifestHash: current.manifestHash,
          paused: current.manifest.paused,
          roles: entries,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "prepare") {
    const current = requireActive(await request("/api/orchestration"));
    const change = preset(args[0], current);
    const prepared = await request("/api/orchestration/prepare", {
      method: "POST",
      body: JSON.stringify(change),
    });
    if (
      prepared?.publicationMode !== "prepared-only" ||
      prepared.rootName !== current.rootName ||
      prepared.currentManifestHash !== current.manifestHash ||
      !isHash(prepared.manifestHash) ||
      prepared.manifest?.version !== current.manifest.version + 1 ||
      !Array.isArray(prepared.diff) ||
      !prepared.requiredAuthorization?.includes("owner-wallet") ||
      !prepared.requiredAuthorization?.includes("world-selfie") ||
      roles.some(
        (role) =>
          !prepared.agentRecords?.[role]?.name ||
          !isHash(prepared.agentRecords[role].settingsHash),
      )
    ) {
      throw new Error("The prepared ENS policy response is invalid");
    }
    write(
      JSON.stringify(
        {
          schema: "urn:eqlty:ens-policy-preparation:v1",
          rootName: prepared.rootName,
          currentManifestHash: prepared.currentManifestHash,
          manifestHash: prepared.manifestHash,
          manifestVersion: prepared.manifest?.version,
          publicationMode: prepared.publicationMode,
          requiredAuthorization: prepared.requiredAuthorization,
          diff: prepared.diff,
          agentRecords: Object.fromEntries(
            roles.map((role) => [
              role,
              {
                name: prepared.agentRecords?.[role]?.name,
                settingsHash: prepared.agentRecords?.[role]?.settingsHash,
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    write(usage());
    return 0;
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
