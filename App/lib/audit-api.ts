import type {
  Portfolio,
  PurchaseAuditBundle,
  PurchaseHistory,
} from "./audit-types";

const fallbackUrl = "http://localhost:4021";
const auditTimeoutMs = 15_000;

export class AuditRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
    () => controller.abort(new Error("audit_timeout")),
    auditTimeoutMs,
  );
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body
          ? String(body.message)
          : response.status === 401
            ? "Verify this wallet in the main app first"
            : `Audit data failed with status ${response.status}`;
      throw new AuditRequestError(response.status, message);
    }
    return body as T;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        "This wallet read is taking longer than expected. Try again to request a fresh snapshot.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function loadPurchaseHistory(
  signal?: AbortSignal,
): Promise<PurchaseHistory> {
  return request<PurchaseHistory>("/api/history", signal);
}

export function loadPurchaseAudit(
  transactionHash: string,
  signal?: AbortSignal,
): Promise<PurchaseAuditBundle> {
  return request<PurchaseAuditBundle>(
    `/api/audits/${encodeURIComponent(transactionHash)}`,
    signal,
  );
}

export function loadPortfolio(signal?: AbortSignal): Promise<Portfolio> {
  return request<Portfolio>("/api/portfolio", signal);
}
