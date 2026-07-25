import type {
  AgentRole,
  EnsAgentMetadata,
  FleetActivation,
  UserSession,
} from "./fleet-types";

const fallbackUrl = "http://localhost:4021";

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
    throw new Error(message);
  }
  return body as T;
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

export function fleetMetadataUrl(role: AgentRole): string {
  return `${apiUrl()}/api/fleet/metadata/${role}`;
}

export function ensManagerUrl(name: string): string {
  return `https://sepolia.app.ens.domains/${encodeURIComponent(name)}`;
}

export async function loadFleetMetadata(
  role: AgentRole,
): Promise<EnsAgentMetadata> {
  return request<EnsAgentMetadata>(`/api/fleet/metadata/${role}`);
}
