import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";
import type {
  SaleAuditBundle,
  SaleHistory,
} from "./sale-audit-types.js";

type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  stringValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
};

type FirestoreList = {
  documents?: FirestoreDocument[];
};

export class FirestoreSaleStore {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async save(
    owner: EvmAddress,
    idToken: string,
    bundle: SaleAuditBundle,
  ): Promise<void> {
    const response = await this.fetchFn(
      `${this.collectionUrl(owner)}?documentId=${documentId(bundle.transactionHash)}`,
      {
        method: "POST",
        headers: this.headers(idToken, true),
        body: JSON.stringify({ fields: toFirestoreMap(bundle) }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (response.ok || response.status === 409) return;
    throw new Error(`Sale database write failed with ${response.status}`);
  }

  async list(
    owner: EvmAddress,
    idToken: string,
  ): Promise<SaleHistory> {
    const response = await this.fetchFn(
      `${this.collectionUrl(owner)}?pageSize=50`,
      {
        headers: this.headers(idToken),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (response.status === 404) return { entries: [] };
    if (!response.ok) {
      throw new Error(`Sale database read failed with ${response.status}`);
    }
    const body = (await response.json()) as FirestoreList;
    const entries = (body.documents ?? []).map(
      (document) =>
        fromFirestoreMap(document.fields) as SaleAuditBundle,
    );
    entries.sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt),
    );
    return { entries };
  }

  private collectionUrl(owner: EvmAddress): string {
    return (
      `https://firestore.googleapis.com/v1/projects/` +
      `${this.config.PERKOS_FIREBASE_PROJECT_ID}/databases/(default)/` +
      `documents/wallets/${owner.toLowerCase()}/eqlty_sales`
    );
  }

  private headers(
    idToken: string,
    json = false,
  ): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${idToken}`,
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }
}

function toFirestoreMap(input: object): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)]),
  );
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  return {
    mapValue: {
      fields: toFirestoreMap(value as Record<string, unknown>),
    },
  };
}

function fromFirestoreMap(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [
      key,
      fromFirestoreValue(value),
    ]),
  );
}

function fromFirestoreValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values ?? []).map(fromFirestoreValue);
  }
  return fromFirestoreMap(value.mapValue?.fields);
}

function documentId(transactionHash: `0x${string}`): string {
  return transactionHash.toLowerCase().slice(2);
}
