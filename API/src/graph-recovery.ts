export type GraphAdapterErrorCode =
  | "quota-exhausted"
  | "provider-error";

export type GraphRecoveryAction =
  | "none"
  | "configure-provider"
  | "renew-quota"
  | "restart-adapter"
  | "check-provider"
  | "wait-for-sync";

export type GraphRecoveryPlan = {
  state: "healthy" | "recovering" | "action-required";
  action: GraphRecoveryAction;
  automatic: boolean;
  message: string;
  blocksRemaining?: number;
  syncPercent?: number;
  nextRetryAt?: string;
};

export function graphAdapterErrorCode(
  lastError?: string,
): GraphAdapterErrorCode | undefined {
  if (!lastError) return undefined;
  if (/quota.+exceed|resource.?exhausted|payment required/i.test(lastError)) {
    return "quota-exhausted";
  }
  return "provider-error";
}

export function graphRetryDelayMs(
  errorCode: GraphAdapterErrorCode | undefined,
  restartCount: number,
): number {
  const attempt = Math.max(0, Math.min(restartCount, 12));
  const base = errorCode === "quota-exhausted" ? 60_000 : 2_000;
  const maximum = errorCode === "quota-exhausted" ? 900_000 : 60_000;
  return Math.min(maximum, base * 2 ** attempt);
}

export function graphSyncPercent(
  processedBlock?: string,
  providerHeadBlock?: string,
): number | undefined {
  if (!processedBlock || !providerHeadBlock) return undefined;
  const processed = BigInt(processedBlock);
  const head = BigInt(providerHeadBlock);
  if (head <= 0n) return undefined;
  const basisPoints = (processed * 10_000n) / head;
  return Number(basisPoints > 10_000n ? 10_000n : basisPoints) / 100;
}

export function graphRecoveryPlan(input: {
  reason?:
    | "not-configured"
    | "unreachable"
    | "not-running"
    | "quota-exhausted"
    | "provider-error"
    | "lagging";
  processedBlock?: string;
  providerHeadBlock?: string;
  lagBlocks?: number;
  nextRetryAt?: string;
}): GraphRecoveryPlan {
  const progress = {
    ...(input.lagBlocks === undefined
      ? {}
      : { blocksRemaining: input.lagBlocks }),
    ...(graphSyncPercent(input.processedBlock, input.providerHeadBlock) ===
    undefined
      ? {}
      : {
          syncPercent: graphSyncPercent(
            input.processedBlock,
            input.providerHeadBlock,
          ),
        }),
    ...(input.nextRetryAt ? { nextRetryAt: input.nextRetryAt } : {}),
  };

  switch (input.reason) {
    case undefined:
      return {
        state: "healthy",
        action: "none",
        automatic: true,
        message: "Live Substreams evidence is synchronized.",
        ...progress,
      };
    case "lagging":
      return {
        state: "recovering",
        action: "wait-for-sync",
        automatic: true,
        message:
          "The adapter is catching up. Decisions remain closed until the lag is safe.",
        ...progress,
      };
    case "not-running":
      return {
        state: "recovering",
        action: "restart-adapter",
        automatic: true,
        message:
          "The stream stopped. The adapter will retry with controlled backoff.",
        ...progress,
      };
    case "quota-exhausted":
      return {
        state: "action-required",
        action: "renew-quota",
        automatic: false,
        message:
          "Provider quota is exhausted. Add capacity; the adapter will resume automatically afterward.",
        ...progress,
      };
    case "not-configured":
      return {
        state: "action-required",
        action: "configure-provider",
        automatic: false,
        message: "Configure a live Substreams provider before enabling decisions.",
        ...progress,
      };
    case "unreachable":
    case "provider-error":
      return {
        state: "action-required",
        action: "check-provider",
        automatic: false,
        message:
          "The provider cannot supply verified evidence. Check connectivity and credentials.",
        ...progress,
      };
  }
}
