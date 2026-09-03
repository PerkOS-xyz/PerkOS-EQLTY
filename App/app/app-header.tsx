import Link from "next/link";
import { AccessButton } from "./access-button";

export function AppHeader({
  active,
}: {
  active: "home" | "markets" | "portfolio" | "history" | "deck";
}) {
  return (
    <header className="topbar">
      <Link aria-label="EQLTY home" className="brand" href="/">
        <span className="brandMark">
          <img alt="" src="/eqlty-logo-mark.png" />
        </span>
        <span className="brandCopy">
          <strong>EQLTY</strong>
          <span>Verifiable agent decisions</span>
        </span>
      </Link>
      <nav aria-label="Primary navigation" className="primaryNav">
        <Link
          aria-current={active === "deck" ? "page" : undefined}
          className={active === "deck" ? "active" : ""}
          href="/deck"
        >
          Deck
        </Link>
        <Link
          aria-current={active === "markets" ? "page" : undefined}
          className={active === "markets" ? "active" : ""}
          href="/markets"
        >
          Markets
        </Link>
        <Link
          aria-current={active === "portfolio" ? "page" : undefined}
          className={active === "portfolio" ? "active" : ""}
          href="/portfolio"
        >
          Portfolio & Sell
        </Link>
        <Link
          aria-current={active === "history" ? "page" : undefined}
          className={active === "history" ? "active" : ""}
          href="/history"
        >
          History
        </Link>
      </nav>
      <div className="topbarActions">
        <span className="network">
          <i />
          Robinhood Chain
        </span>
        <AccessButton />
      </div>
    </header>
  );
}
