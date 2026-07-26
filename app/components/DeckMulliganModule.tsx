"use client";

import { useState } from "react";
import type { DeckBasicPokemon } from "@/lib/primaryCardImage";

interface Props {
  deckSize: number;
  basicCount: number;
  /** Every Basic-stage Pokémon line in the deck, for the Draw 7 simulator. */
  basics: DeckBasicPokemon[];
}

/**
 * Probability the opening 7-card hand contains zero Basic Pokémon
 * (the condition that forces a mulligan). Hypergeometric:
 *   P = Π (i=0..6) (N - B - i) / (N - i)
 * where N = deck size, B = number of Basic Pokémon in the deck.
 */
function mulliganProbability(deckSize: number, basicCount: number): number {
  if (deckSize < 7) return 0;
  if (basicCount <= 0) return 1;
  if (deckSize - basicCount < 7) return 0;
  let p = 1;
  for (let i = 0; i < 7; i++) {
    p *= (deckSize - basicCount - i) / (deckSize - i);
  }
  return p;
}

interface DrawnCard {
  name: string;
  imageUrl: string | null;
}

/** One 60-card shoe slot: a specific Basic Pokémon, or null for every
 *  other card in the deck (irrelevant to the mulligan check). */
function buildShoe(deckSize: number, basics: DeckBasicPokemon[]): (DrawnCard | null)[] {
  const shoe: (DrawnCard | null)[] = [];
  for (const b of basics) {
    for (let i = 0; i < b.qty; i++) shoe.push({ name: b.name, imageUrl: b.imageUrl });
  }
  while (shoe.length < deckSize) shoe.push(null);
  return shoe;
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Simulates `count` independent opening hands, each drawing the first 7
 *  cards off a freshly shuffled copy of the deck. A game's card list is
 *  empty when no Basic Pokémon landed in the hand (a mulligan). */
function simulateGames(
  deckSize: number,
  basics: DeckBasicPokemon[],
  count: number,
): DrawnCard[][] {
  if (deckSize < 7) return Array.from({ length: count }, () => []);
  const shoe = buildShoe(deckSize, basics);
  const games: DrawnCard[][] = [];
  for (let g = 0; g < count; g++) {
    const hand = shuffled(shoe).slice(0, 7);
    games.push(hand.filter((c): c is DrawnCard => c !== null));
  }
  return games;
}

export default function DeckMulliganModule({ deckSize, basicCount, basics }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [games, setGames] = useState<DrawnCard[][] | null>(null);

  if (deckSize <= 0) return null;

  const prob = mulliganProbability(deckSize, basicCount);
  const pct = prob * 100;
  // One decimal under 10% so very-low odds don't all collapse to "0%".
  const label =
    pct >= 10 ? `${pct.toFixed(0)}%` : pct >= 0.1 ? `${pct.toFixed(1)}%` : "<0.1%";

  const cardClass =
    "rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5";

  // Re-simulates on every open so re-expanding deals a fresh set of hands.
  function toggle() {
    setExpanded((e) => {
      const next = !e;
      if (next) setGames(simulateGames(deckSize, basics, 10));
      return next;
    });
  }

  return (
    <div className={cardClass}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3"
      >
        <h2 className="text-lg font-semibold">Mulligan Risk</h2>
        <span className="flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-text-primary">
            {label}
          </span>
          <svg
            className={`w-5 h-5 text-text-muted transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {expanded && games && (
        <div className="mt-4">
          <p className="text-xs text-text-muted mb-3">
            Draw 7 simulator — the Basic Pok&eacute;mon that would open in each
            of 10 simulated hands.
          </p>
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
            {games.map((hand, i) => (
              <li
                key={i}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="w-14 shrink-0 text-xs font-semibold text-text-secondary">
                  Game {i + 1}
                </span>
                {hand.length === 0 ? (
                  <span className="text-xs font-bold tracking-wide text-accent">
                    MULLIGAN
                  </span>
                ) : (
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {hand.map((c, j) =>
                      c.imageUrl ? (
                        <img
                          key={j}
                          src={c.imageUrl}
                          alt={c.name}
                          title={c.name}
                          className="h-10 w-auto rounded-md border border-black/10 dark:border-white/10 shadow-sm"
                          style={{ aspectRatio: "245 / 342" }}
                        />
                      ) : (
                        <span
                          key={j}
                          title={c.name}
                          className="flex h-10 items-center rounded-md border border-black/10 dark:border-white/10 bg-surface px-1.5 text-center text-[9px] font-semibold leading-tight text-text-secondary"
                          style={{ aspectRatio: "245 / 342" }}
                        >
                          {c.name}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
