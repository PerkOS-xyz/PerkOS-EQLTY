import type { Metadata } from "next";
import { DeckPresenter } from "./deck-presenter";

export const metadata: Metadata = {
  title: "EQLTY — Presentation",
  description:
    "A verifiable financial assistant fleet for tokenized stock decisions.",
};

export default function DeckPage() {
  return <DeckPresenter />;
}
