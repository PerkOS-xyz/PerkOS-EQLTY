/**
 * X-Agent-Info, the optional header the Uniswap Trading API reads to tell
 * agent traffic apart. It is analytics only: sending it, omitting it or
 * sending a bad value never changes a response. The checks below are the rules
 * the Trading API reference gives for the header. The gateway drops a value
 * that breaks them and reports it in the x-agent-info-status response header,
 * so EQLTY refuses to build such a value at all. EQLTY puts only constants in
 * it, never a wallet, user id, email or token.
 */

export const decisionOrigins = ["autonomous", "human_mediated"] as const;

export type DecisionOrigin = (typeof decisionOrigins)[number];

/** The origin a Trading API call carried and what the gateway said about it. */
export type UniswapAttribution = {
  decisionOrigin: DecisionOrigin;
  /** The x-agent-info-status response header, or null when there was none. */
  status: string | null;
};

/**
 * The origin a Trading API call carries unless its caller says otherwise.
 * The paths that quote or build a swap for a decision start with a person and
 * end at a person's approval. A goal is evaluated only inside its owner's
 * signed-in requests, because autonomous-goals.ts runs no background loop. A
 * proof run prepares a swap only from the owner's POST /api/runs
 * (proof-run.ts), and the trade skill asks for execution only when the user
 * requests a live purchase. A desk order is sent only after the owner
 * approves it, and a wallet sale is signed by the owner. So the default is
 * human_mediated, and a caller with no person behind it, such as the agent
 * quote endpoint, passes autonomous.
 */
export const defaultDecisionOrigin: DecisionOrigin = "human_mediated";

/**
 * How EQLTY names itself in the header. It sends no version: a number kept by
 * hand would drift from the release.
 */
export const integrationName = "eqlty";

const maxFieldUnits = 256;
const maxHeaderBytes = 1_024;
const disallowedCodePoints = new Set([0x2028, 0x2029, 0xfffd]);

/** The header value, or an error naming the rule the input breaks. */
export function agentInfoHeader(input: {
  decisionOrigin: string;
  integrationName?: string;
  version?: string;
}): string {
  if (
    !(decisionOrigins as readonly string[]).includes(input.decisionOrigin)
  ) {
    throw new Error(
      "decision_origin must be exactly autonomous or human_mediated",
    );
  }
  const value: Record<string, string> = {
    decision_origin: input.decisionOrigin,
  };
  const fields = [
    ["integration_name", input.integrationName],
    ["version", input.version],
  ] as const;
  for (const [key, raw] of fields) {
    if (raw === undefined) continue;
    if (typeof raw !== "string") {
      throw new Error(`${key} must be a string`);
    }
    if (raw.length > maxFieldUnits) {
      throw new Error(`${key} exceeds ${maxFieldUnits} UTF-16 code units`);
    }
    if (hasDisallowedCharacter(raw)) {
      throw new Error(`${key} contains a disallowed character`);
    }
    value[key] = raw;
  }
  const header = JSON.stringify(value);
  if (!/^[\x20-\x7E]*$/.test(header)) {
    throw new Error("X-Agent-Info must be printable ASCII");
  }
  const bytes = Buffer.byteLength(header, "utf8");
  if (bytes > maxHeaderBytes) {
    throw new Error(
      `X-Agent-Info is ${bytes} bytes; the limit is ${maxHeaderBytes}`,
    );
  }
  return header;
}

/** Control characters (C0, DEL and C1), U+2028, U+2029 and U+FFFD. */
function hasDisallowedCharacter(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      disallowedCodePoints.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}
