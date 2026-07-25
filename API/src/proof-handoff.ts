import { keccak256, stringToHex } from "viem";
import type {
  AgentHandoff,
  ProofMode,
} from "./execution-types.js";

export function createHandoff(input: {
  from: AgentHandoff["from"];
  to: AgentHandoff["to"];
  kind: AgentHandoff["kind"];
  mode: ProofMode;
  payload: unknown;
  at: string;
}): AgentHandoff {
  const outputHash = hashPayload({
    from: input.from,
    to: input.to,
    kind: input.kind,
    payload: input.payload,
    at: input.at,
  });
  return {
    id: `${input.kind}:${outputHash.slice(2, 14)}`,
    from: input.from,
    to: input.to,
    kind: input.kind,
    mode: input.mode,
    status: "sealed",
    outputHash,
    at: input.at,
  };
}

export function hashPayload(payload: unknown): `0x${string}` {
  return keccak256(stringToHex(stableStringify(payload)));
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(record[key])}`,
    )
    .join(",")}}`;
}
