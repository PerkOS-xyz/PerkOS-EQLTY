const providerDiagnostics = [
  "request body:",
  "request arguments:",
  "contract call:",
  "raw transaction",
];

const knownProviderErrors: Array<[RegExp, string]> = [
  [
    /replacement transaction underpriced/i,
    "An ENS transaction is still settling. Retry after it confirms.",
  ],
  [
    /nonce too low|nonce has already been used/i,
    "The ENS transaction state changed. Retry the request.",
  ],
  [
    /insufficient funds/i,
    "The ENS registrar needs more network gas.",
  ],
  [
    /execution reverted/i,
    "The onchain request was rejected.",
  ],
];

export function publicErrorMessage(
  error: unknown,
  fallback = "Request failed",
): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;

  for (const [pattern, replacement] of knownProviderErrors) {
    if (pattern.test(message)) return replacement;
  }

  const lower = message.toLowerCase();
  if (
    providerDiagnostics.some((marker) => lower.includes(marker)) ||
    /https?:\/\//i.test(message) ||
    /0x[0-9a-f]{128,}/i.test(message)
  ) {
    return "The external provider rejected the request.";
  }

  return message.slice(0, 512);
}
