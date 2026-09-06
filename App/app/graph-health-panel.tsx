import type { GraphIntegrationHealth } from "../lib/market-api";
import { relativeTime } from "../lib/market-format";

type Props = {
  compact?: boolean;
  health?: GraphIntegrationHealth;
  onRefresh: () => void;
};

export function GraphHealthPanel({ compact, health, onRefresh }: Props) {
  const recovery = health?.recovery;
  const state = recovery?.state ?? health?.status ?? "pending";
  const progress = recovery?.syncPercent;
  const title = healthTitle(health);
  const message = recovery?.message ?? healthMessage(health);

  return (
    <aside
      aria-label="Onchain evidence status"
      className={`graphHealthPanel ${state} ${compact ? "compact" : ""}`}
    >
      <div className="graphHealthLead">
        <span aria-hidden="true" className="graphHealthSignal" />
        <div>
          <small>{providerLabel(health)}</small>
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
      </div>

      {health && (
        <div className="graphHealthDetails">
          {recovery?.blocksRemaining !== undefined && (
            <span>
              <small>Block lag</small>
              <b>{number(recovery.blocksRemaining)}</b>
            </span>
          )}
          {health.observedTickers !== undefined && (
            <span>
              <small>Observed stocks</small>
              <b>{number(health.observedTickers)}</b>
            </span>
          )}
          {health.processedBlock && (
            <span>
              <small>Checkpoint</small>
              <b>{number(Number(health.processedBlock))}</b>
            </span>
          )}
        </div>
      )}

      {progress !== undefined && (
        <div className="graphSyncProgress">
          <span>
            <small>Chain sync</small>
            <b>{progress.toFixed(2)}%</b>
          </span>
          <div
            aria-label="Onchain evidence synchronization progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            role="progressbar"
          >
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="graphHealthActions">
        <span>
          {health?.lastProgressAt
            ? `Last block ${relativeTime(health.lastProgressAt)}`
            : health?.checkedAt
              ? `Checked ${relativeTime(health.checkedAt)}`
              : "Checking provider"}
          {recovery?.nextRetryAt && ` · retry ${retryTime(recovery.nextRetryAt)}`}
        </span>
        <button onClick={onRefresh} type="button">
          Refresh status
        </button>
      </div>
    </aside>
  );
}

function healthTitle(health?: GraphIntegrationHealth): string {
  if (!health) return "Checking evidence";
  if (health.status === "ready") return "Evidence synchronized";
  switch (health.reason) {
    case "quota-exhausted":
      return "Provider quota exhausted";
    case "lagging":
      return "Evidence is catching up";
    case "not-running":
      return "Stream is restarting";
    case "not-configured":
      return "Provider setup required";
    case "unreachable":
    case "provider-error":
      return "Provider needs attention";
    default:
      return "Evidence is unavailable";
  }
}

function healthMessage(health?: GraphIntegrationHealth): string {
  if (!health) return "Reading the current onchain checkpoint.";
  if (health.status === "ready") {
    return health.evidenceProvider === "the-graph-substreams"
      ? "Live Substreams evidence is synchronized."
      : "Robinhood Chain evidence is current.";
  }
  return "Decisions remain safely closed until evidence is current.";
}

function providerLabel(health?: GraphIntegrationHealth): string {
  if (health?.evidenceProvider === "the-graph-substreams") {
    return "The Graph Substreams";
  }
  return "Robinhood Chain · Onchain evidence";
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function retryTime(value: string): string {
  const milliseconds = Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "pending";
  const seconds = Math.ceil(milliseconds / 1_000);
  if (seconds < 60) return `in ${seconds}s`;
  return `in ${Math.ceil(seconds / 60)}m`;
}
