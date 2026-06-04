"use client";

import { useState } from "react";

/* ─── Types ────────────────────────────────────────────────────── */

interface Card {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

interface DeckListClientProps {
  cards: Card[];
}

/* ─── Helpers ──────────────────────────────────────────────────── */

const CATEGORY_ORDER: Card["category"][] = ["pokemon", "trainer", "energy"];
const CATEGORY_LABELS: Record<Card["category"], string> = {
  pokemon: "Pokémon",
  trainer: "Trainer",
  energy: "Energy",
};

function groupByCategory(cards: Card[]) {
  const groups: Record<string, Card[]> = {};
  for (const cat of CATEGORY_ORDER) {
    const items = cards.filter((c) => c.category === cat);
    if (items.length > 0) groups[cat] = items;
  }
  return groups;
}

function buildExportText(cards: Card[]): string {
  const groups = groupByCategory(cards);
  const sections: string[] = [];

  for (const cat of CATEGORY_ORDER) {
    const items = groups[cat];
    if (!items) continue;
    const total = items.reduce((s, c) => s + c.qty, 0);
    const label = CATEGORY_LABELS[cat];
    const lines = items.map((c) => `${c.qty} ${c.name} ${c.setCode} ${c.number}`);
    sections.push(`${label}: ${total}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n") + "\n";
}

/* ─── Component ────────────────────────────────────────────────── */

const clipboardIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
  </svg>
);

const checkIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export default function DeckListClient({ cards }: DeckListClientProps) {
  const [copied, setCopied] = useState(false);

  if (cards.length === 0) {
    return (
      <p className="text-sm text-text-muted italic">Deck list not available</p>
    );
  }

  const groups = groupByCategory(cards);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildExportText(cards));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Sample Deck List</h3>
        <button
          onClick={handleCopy}
          title="Copy deck list"
          className="inline-flex items-center justify-center pl-3 pr-0 py-[7px] text-text-primary opacity-50 hover:opacity-100 transition-opacity"
        >
          {copied ? checkIcon : clipboardIcon}
        </button>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const items = groups[cat];
        if (!items) return null;
        const total = items.reduce((s, c) => s + c.qty, 0);

        return (
          <div key={cat} className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              {CATEGORY_LABELS[cat]} — {total}
            </h4>
            <div className="space-y-0.5">
              {items.map((c, i) => (
                <div key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="text-text-muted w-5 text-right flex-shrink-0">×{c.qty}</span>
                  <span className="text-text-primary">{c.name}</span>
                  <span className="text-text-muted text-xs">{c.setCode} {c.number}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

    </div>
  );
}
