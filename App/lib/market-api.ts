import type { StockCatalog } from "./market-types";

const fallbackUrl = "http://localhost:4021";

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

function isStockCatalog(value: unknown): value is StockCatalog {
  if (!value || typeof value !== "object") {
    return false;
  }
  const catalog = value as Partial<StockCatalog>;
  return (
    catalog.chainId === 4663 &&
    catalog.quoteToken === "USDG" &&
    typeof catalog.observedAt === "string" &&
    Array.isArray(catalog.assets) &&
    Boolean(catalog.summary)
  );
}

export async function loadStockCatalog(
  refresh = false,
  signal?: AbortSignal,
): Promise<StockCatalog> {
  const query = refresh ? "&refresh=true" : "";
  const response = await fetch(
    `${apiUrl()}/api/assets?catalog=uniswap-v4-universe${query}`,
    {
      credentials: "include",
      headers: {
        accept: "application/json",
      },
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Market request failed with status ${response.status}`;
    throw new Error(message);
  }
  if (!isStockCatalog(body)) {
    throw new Error("The market response is incomplete");
  }
  return body;
}
