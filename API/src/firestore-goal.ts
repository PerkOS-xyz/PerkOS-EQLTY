import type { ApiConfig } from "./config.js";
import type {
  AutonomousGoal,
  GoalInput,
} from "./goal-types.js";
import type { EvmAddress } from "./market-types.js";

type FirestoreDocument = {
  fields?: {
    payload?: { stringValue?: string };
  };
};

type FirestoreCollection = {
  documents?: FirestoreDocument[];
};

export type PersistedGoal = {
  goal: AutonomousGoal;
  input: Omit<GoalInput, "perkosIdToken">;
};

export type GoalStore = {
  latest(
    owner: EvmAddress,
    idToken: string,
  ): Promise<PersistedGoal | undefined>;
  read(
    owner: EvmAddress,
    idToken: string,
    goalId: string,
  ): Promise<PersistedGoal | undefined>;
  save(
    owner: EvmAddress,
    idToken: string,
    goalId: string,
    goal: PersistedGoal,
  ): Promise<void>;
};

export class FirestoreGoalStore implements GoalStore {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async latest(
    owner: EvmAddress,
    idToken: string,
  ): Promise<PersistedGoal | undefined> {
    const response = await this.fetchFn(
      `${this.collectionUrl(owner)}?pageSize=100`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${idToken}`,
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Goal database list failed with ${response.status}`);
    }
    const collection = (await response.json()) as FirestoreCollection;
    return (collection.documents ?? [])
      .map(parseDocument)
      .filter((goal): goal is PersistedGoal => goal !== undefined)
      .filter(isResumable)
      .sort(
        (left, right) =>
          Date.parse(right.goal.startedAt) - Date.parse(left.goal.startedAt),
      )[0];
  }

  async read(
    owner: EvmAddress,
    idToken: string,
    goalId: string,
  ): Promise<PersistedGoal | undefined> {
    const response = await this.fetchFn(this.documentUrl(owner, goalId), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${idToken}`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Goal database read failed with ${response.status}`);
    }
    const document = (await response.json()) as FirestoreDocument;
    const payload = document.fields?.payload?.stringValue;
    if (!payload) return undefined;
    return JSON.parse(payload) as PersistedGoal;
  }

  async save(
    owner: EvmAddress,
    idToken: string,
    goalId: string,
    goal: PersistedGoal,
  ): Promise<void> {
    const response = await this.fetchFn(this.documentUrl(owner, goalId), {
      method: "PATCH",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: JSON.stringify(goal) },
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`Goal database write failed with ${response.status}`);
    }
  }

  private documentUrl(owner: EvmAddress, goalId: string): string {
    return `${this.collectionUrl(owner)}/${encodeURIComponent(goalId)}`;
  }

  private collectionUrl(owner: EvmAddress): string {
    return (
      `https://firestore.googleapis.com/v1/projects/` +
      `${this.config.PERKOS_FIREBASE_PROJECT_ID}/databases/(default)/` +
      `documents/wallets/${owner.toLowerCase()}/eqlty_goals`
    );
  }
}

function parseDocument(
  document: FirestoreDocument,
): PersistedGoal | undefined {
  const payload = document.fields?.payload?.stringValue;
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as PersistedGoal;
  } catch {
    return undefined;
  }
}

function isResumable(value: PersistedGoal): boolean {
  const feeStatus = value.goal.decisionFee?.status;
  return (
    value.goal.status === "completed" &&
    value.goal.latest !== undefined &&
    (feeStatus === "settled" || feeStatus === "preview")
  );
}
