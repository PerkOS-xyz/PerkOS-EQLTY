"use client";

import Link from "next/link";
import { AppHeader } from "../app-header";
import { useAuditResource } from "../use-audit-resource";
import { loadPortfolio } from "../../lib/audit-api";
import {
  dateTime,
  percent,
  shares,
  signedMoney,
} from "../../lib/audit-format";
import type { PortfolioHolding } from "../../lib/audit-types";
import { addressUrl } from "../../lib/execution-api";
import { money } from "../../lib/market-format";
import { RecoverableFunds } from "./recoverable-funds";
import { SellPosition } from "./sell-position";

export default function PortfolioPage() {
  const state = useAuditResource(loadPortfolio);
  const portfolio = state.data;
  const gain = portfolio?.summary.unrealizedGainUsd;

  return (
    <div className="shell">
      <AppHeader active="portfolio" />
      <main className="auditContent">
        <section className="auditHero portfolioHero">
          <div>
            <span className="eyebrow">Robinhood Chain wallet</span>
            <h1>Your stock tokens</h1>
            <p>
              Current wallet balances, reference prices and verifiable EQLTY
              purchase cost in one place.
            </p>
          </div>
          <div className="auditHeroMetric">
            <span>Portfolio value</span>
            <strong>{money(portfolio?.summary.marketValueUsd)}</strong>
            <small>
              {portfolio ? `${portfolio.summary.positions} positions` : "—"}
            </small>
          </div>
        </section>

        <section className="usdGExit" id="sell-to-usdg">
          <div>
            <span>Demo liquidity</span>
            <strong>Need USDG back?</strong>
            <p>
              Sell any stock-token position through Uniswap and receive USDG
              directly in your connected wallet.
            </p>
          </div>
          <a href="#stock-positions">Choose a position to sell</a>
        </section>

        {portfolio?.status === "ready" && (
          <section className="portfolioSummary" aria-label="Portfolio summary">
            <span>
              <small>Positions</small>
              <strong>{portfolio.summary.positions}</strong>
            </span>
            <span>
              <small>Verified cost</small>
              <strong>{money(portfolio.summary.costBasisUsd)}</strong>
            </span>
            <span>
              <small>Unrealized gain</small>
              <strong className={gainClass(gain)}>
                {signedMoney(gain)}
              </strong>
            </span>
            <span>
              <small>Cost coverage</small>
              <strong>
                {portfolio.coverage.verifiedCostPositions}/
                {portfolio.summary.positions}
              </strong>
            </span>
          </section>
        )}

        <RecoverableFunds />

        {state.phase === "disconnected" && (
          <PortfolioState
            copy="Connect the wallet that holds your Robinhood stock tokens."
            title="Connect your wallet"
          />
        )}
        {state.phase === "loading" && (
          <PortfolioState
            busy
            copy="Checking stock token balances and current prices."
            title="Loading portfolio"
          />
        )}
        {state.phase === "authenticating" && (
          <PortfolioState
            busy
            copy="Confirm the EQLTY ownership message in your wallet. This does not move funds."
            title="Confirm wallet ownership"
          />
        )}
        {state.phase === "error" && (
          <PortfolioState
            action={state.refresh}
            copy={state.error ?? "Portfolio data is unavailable."}
            title="Portfolio needs attention"
          />
        )}
        {state.phase === "ready" && portfolio?.status === "pending" && (
          <PortfolioState
            copy="Robinhood Chain portfolio reads will activate with the final EQLTY vault configuration."
            title="Portfolio is pending"
          />
        )}
        {state.phase === "ready" &&
          portfolio?.status === "ready" &&
          portfolio.holdings.length === 0 && (
            <PortfolioState
              copy="Stock tokens received by this wallet will appear here after the first purchase."
              title="No stock tokens found"
            />
          )}

        {portfolio?.status === "ready" &&
          portfolio.holdings.length > 0 && (
            <>
              <div className="auditToolbar">
                <div>
                  <strong>Current holdings</strong>
                  <span>
                    Updated {dateTime(portfolio.observedAt)}
                  </span>
                </div>
                <button onClick={state.refresh} type="button">
                  Refresh balances
                </button>
              </div>
              <section
                aria-label="Stock token holdings"
                className="holdingGrid"
                id="stock-positions"
              >
                {portfolio.holdings.map((holding) => (
                  <HoldingCard
                    holding={holding}
                    key={holding.tokenAddress}
                    onComplete={state.refresh}
                  />
                ))}
              </section>
              {portfolio.coverage.unreadableTokens > 0 && (
                <p className="coverageNote">
                  {portfolio.coverage.unreadableTokens} token reads were
                  unavailable in this snapshot.
                </p>
              )}
            </>
          )}
      </main>
    </div>
  );
}

function HoldingCard({
  holding,
  onComplete,
}: {
  holding: PortfolioHolding;
  onComplete: () => void;
}) {
  return (
    <article className="holdingCard">
      <header>
        <span className="assetMonogram">
          {holding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={holding.logoUrl} />
          ) : (
            holding.ticker.slice(0, 1)
          )}
        </span>
        <div>
          <strong>{holding.ticker}</strong>
          <small>{holding.name}</small>
        </div>
        <b className={holding.costStatus}>
          {costLabel(holding.costStatus)}
        </b>
      </header>
      <div className="holdingBalance">
        <span>{shares(holding.balance)}</span>
        <small>tokens in wallet</small>
      </div>
      <dl>
        <div>
          <dt>Current price</dt>
          <dd>{money(holding.currentPriceUsd)}</dd>
        </div>
        <div>
          <dt>Average cost</dt>
          <dd>{money(holding.averageCostUsd)}</dd>
        </div>
        <div>
          <dt>Market value</dt>
          <dd>{money(holding.marketValueUsd)}</dd>
        </div>
        <div>
          <dt>Unrealized gain</dt>
          <dd className={gainClass(holding.unrealizedGainUsd)}>
            {signedMoney(holding.unrealizedGainUsd)}
            <small>{percent(holding.unrealizedGainPercent)}</small>
          </dd>
        </div>
      </dl>
      <footer>
        <SellPosition holding={holding} onComplete={onComplete} />
        <a
          href={addressUrl(holding.tokenAddress)}
          rel="noreferrer"
          target="_blank"
        >
          Token contract
        </a>
        <Link href="/history">
          {holding.purchaseCount > 0
            ? `${holding.purchaseCount} purchase${holding.purchaseCount === 1 ? "" : "s"}`
            : "Purchase history"}
        </Link>
      </footer>
    </article>
  );
}

function PortfolioState({
  title,
  copy,
  busy = false,
  action,
}: {
  title: string;
  copy: string;
  busy?: boolean;
  action?: () => void;
}) {
  return (
    <section className={`auditState ${busy ? "busy" : ""}`}>
      <i />
      <strong>{title}</strong>
      <p>{copy}</p>
      {action ? (
        <button onClick={action} type="button">
          Try again
        </button>
      ) : title === "Connect your wallet" ? (
        <Link href="/">Return to app</Link>
      ) : null}
    </section>
  );
}

function costLabel(status: PortfolioHolding["costStatus"]): string {
  if (status === "verified") return "Verified cost";
  if (status === "partial") return "Partial cost";
  return "Cost unavailable";
}

function gainClass(value: number | undefined): string {
  if (value === undefined || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}
