import type { ApiConfig } from "./config.js";
import {
  GraphEvidenceService,
  type GraphEvidence,
  type GraphIntegrationStatus,
  type OnchainPriceSeries,
} from "./graph-evidence.js";
import { RpcEvidenceService } from "./rpc-evidence.js";

export type MarketEvidenceProvider = {
  ready(): boolean;
  status(): Promise<GraphIntegrationStatus>;
  evidence(ticker: string): Promise<GraphEvidence>;
  series(tickers: string[]): Promise<OnchainPriceSeries>;
};

type Dependencies = {
  graph?: MarketEvidenceProvider;
  rpc?: MarketEvidenceProvider;
};

export class MarketEvidenceService implements MarketEvidenceProvider {
  private readonly selected: MarketEvidenceProvider;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.selected =
      config.EQLTY_EVIDENCE_PROVIDER === "graph"
        ? dependencies.graph ?? new GraphEvidenceService(config)
        : dependencies.rpc ?? new RpcEvidenceService(config);
  }

  ready(): boolean {
    return this.selected.ready();
  }

  async status(): Promise<GraphIntegrationStatus> {
    const status = await this.selected.status();
    return {
      ...status,
      evidenceProvider:
        this.config.EQLTY_EVIDENCE_PROVIDER === "graph"
          ? "the-graph-substreams"
          : "robinhood-rpc",
      providerName:
        status.providerName ??
        (this.config.EQLTY_EVIDENCE_PROVIDER === "graph"
          ? "The Graph Substreams"
          : "Robinhood JSON-RPC"),
    };
  }

  evidence(ticker: string): Promise<GraphEvidence> {
    return this.selected.evidence(ticker);
  }

  series(tickers: string[]): Promise<OnchainPriceSeries> {
    return this.selected.series(tickers);
  }
}
