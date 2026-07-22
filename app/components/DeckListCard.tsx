"use client";

import CopyDeckListButton from "@/app/components/CopyDeckListButton";

/**
 * Shared "Deck List" module — renders a raw deck-list string as grouped
 * Pokémon / Trainer / Energy sections. Used by both the saved-deck view
 * (/my-decks/[id]) and the meta-deck profile (/meta-archetypes/[slug]).
 */

interface ParsedCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
}
interface ParsedSection {
  label: string;
  cards: ParsedCard[];
}

const CATEGORY_MAP: Record<string, string> = {
  "pokémon": "Pokémon",
  "pokemon": "Pokémon",
  "trainer": "Trainer",
  "energy": "Energy",
};

function parseDeckList(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^([^:]+):\s*\d+/);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      if (key in CATEGORY_MAP) {
        current = { label: CATEGORY_MAP[key], cards: [] };
        sections.push(current);
        continue;
      }
    }
    if (current) {
      const tokens = trimmed.split(/\s+/);
      const qty = parseInt(tokens[0]);
      if (!isNaN(qty) && tokens.length >= 4) {
        current.cards.push({
          qty,
          name: tokens.slice(1, tokens.length - 2).join(" "),
          setCode: tokens[tokens.length - 2],
          number: tokens[tokens.length - 1],
        });
      }
    }
  }
  return sections;
}

export default function DeckListCard({ deckList }: { deckList: string }) {
  const sections = parseDeckList(deckList);
  if (sections.length === 0) return null;
  return (
    <details className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5 group">
      <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold">Deck List</h2>
        <div className="flex items-center gap-2">
          {/* Stop the copy click from toggling the accordion. */}
          <span onClick={(e) => e.stopPropagation()}>
            <CopyDeckListButton deckList={deckList} iconOnly />
          </span>
          <svg
            className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </summary>
      <div className="mt-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-4 last:mb-0">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              {section.label} — {section.cards.reduce((s, c) => s + c.qty, 0)}
            </h4>
            <div className="space-y-0.5">
              {section.cards.map((c, i) => (
                <div key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="text-text-muted w-5 text-right flex-shrink-0">×{c.qty}</span>
                  <span className="text-text-primary">{c.name}</span>
                  <span className="text-text-muted text-xs">{c.setCode} {c.number}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
