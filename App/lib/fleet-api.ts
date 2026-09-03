import type {
  AgentRole,
  EnsAgentMetadata,
  FleetActivation,
  FleetComputeStatus,
  FleetFundingPayment,
  FleetFundingQuote,
  FleetFundingReceipt,
  FleetPolicyChange,
  FleetPolicyPublication,
  FleetPolicy,
  OneClawIntegrationHealth,
  OneClawFleetSecurity,
  OneClawUserConnection,
  UserSession,
} from "./fleet-types";

const fallbackUrl = "http://localhost:4021";
const fallbackEnsAppUrl = "https://app.ens.dev";

export class FleetRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly funding?: FleetFundingQuote,
  ) {
    super(message);
  }
}

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Fleet request failed with status ${response.status}`;
    const code =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : undefined;
    const funding =
      body && typeof body === "object" && "funding" in body
        ? (body.funding as FleetFundingQuote)
        : undefined;
    throw new FleetRequestError(response.status, message, code, funding);
  }
  return body as T;
}

export async function loadFleetSession(): Promise<UserSession | undefined> {
  try {
    return await request<UserSession>("/api/auth/session");
  } catch (error) {
    if (error instanceof FleetRequestError && error.status === 401) {
      return undefined;
    }
    throw error;
  }
}

export async function requestFleetChallenge(address: `0x${string}`) {
  return request<{
    nonce: string;
    message: string;
    expiresAt: number | string;
  }>(`/api/auth/perkos/nonce?address=${encodeURIComponent(address)}`);
}

export async function verifyFleetOwner(
  address: `0x${string}`,
  nonce: string,
  signature: `0x${string}`,
): Promise<UserSession> {
  return request<UserSession>("/api/auth/perkos/verify", {
    method: "POST",
    body: JSON.stringify({
      address,
      nonce,
      signature,
    }),
  });
}

export async function activateFleet(): Promise<FleetActivation> {
  return request<FleetActivation>("/api/fleet/activate", {
    method: "POST",
  });
}

export async function fundFleet(
  payment: FleetFundingPayment,
): Promise<FleetFundingReceipt> {
  return request<FleetFundingReceipt>("/api/fleet/funding", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

export async function loadFleetCompute(): Promise<FleetComputeStatus> {
  return request<FleetComputeStatus>("/api/fleet/billing");
}

export async function activateOneClawRails(
  email: string,
): Promise<OneClawFleetSecurity> {
  return request<OneClawFleetSecurity>(
    "/api/fleet/security/oneclaw",
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
}

export async function loadOneClawUserConnection(): Promise<OneClawUserConnection> {
  return request<OneClawUserConnection>(
    "/api/fleet/security/oneclaw",
  );
}

export async function loadOneClawIntegrationHealth(
  signal?: AbortSignal,
): Promise<OneClawIntegrationHealth> {
  const response = await fetch(`${apiUrl()}/api/config`, {
    credentials: "include",
    headers: { accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => undefined);
  const health =
    body && typeof body === "object" && "integrationHealth" in body
      ? (
          body as {
            integrationHealth?: {
              oneclaw?: OneClawIntegrationHealth;
            };
          }
        ).integrationHealth?.oneclaw
      : undefined;
  if (
    !response.ok ||
    !health ||
    !["ready", "degraded", "pending"].includes(health.status)
  ) {
    throw new Error("1Claw readiness is unavailable");
  }
  return health;
}

export function oneclawAgentSettingsUrl(agentId?: string): string {
  return agentId
    ? `https://1claw.xyz/agents/${encodeURIComponent(agentId)}`
    : "https://1claw.xyz/agents";
}

export function fleetMetadataUrl(role: AgentRole): string {
  return `${apiUrl()}/api/fleet/metadata/${role}`;
}

export function ensManagerUrl(name: string): string {
  const configured =
    process.env.NEXT_PUBLIC_EQLTY_ENS_APP_URL?.trim() ||
    fallbackEnsAppUrl;
  const baseUrl = configured.includes("sepolia.app.ens.domains")
    ? fallbackEnsAppUrl
    : configured;
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(name)}`;
}

export async function loadFleetMetadata(
  role: AgentRole,
): Promise<EnsAgentMetadata> {
  return request<EnsAgentMetadata>(`/api/fleet/metadata/${role}`);
}

export async function loadFleetPolicy(): Promise<FleetPolicy> {
  return request<FleetPolicy>("/api/fleet/policy");
}

export async function publishDemoFleetPolicy(
  change: FleetPolicyChange,
): Promise<FleetPolicyPublication> {
  return request<FleetPolicyPublication>(
    "/api/orchestration/apply-demo",
    {
      method: "POST",
      body: JSON.stringify(change),
    },
  );
}
