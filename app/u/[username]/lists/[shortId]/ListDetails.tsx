"use client";

import { useMemo, useState } from "react";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import { typeIconUrl } from "@/lib/typeIcon";

/**
 * Collapsible "List details" summary shown above the card grid on a saved
 * list. Stats describe the whole list, not the currently filtered view —
 * they're a property of the list itself, so narrowing the search below
 * shouldn't move them.
 */

/** Energy-type display order, matching the TCG's own ordering rather than
 *  the arbitrary order types happen to appear in the list. */
const TYPE_ORDER = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Fairy",
  "Colorless",
];

type CountRow = { label: string; count: number };

/**
 * Energy types a card contributes to the "Energy" row. Pokémon carry their
 * type directly. Energy cards ship with an empty `types` array in the
 * bundled catalog, so a "Lightning Energy" in the list would otherwise
 * register no energy at all — read the type off the name instead
 * ("Basic Fire Energy" → Fire, "Double Colorless Energy" → Colorless).
 * Typeless special energies (Jet, Reversal, …) simply contribute nothing.
 */
function energyTypesFor(card: CardIndexEntry): string[] {
  if (card.types.length > 0) return card.types;
  if (card.supertype !== "Energy") return [];
  return TYPE_ORDER.filter((t) => card.name.includes(t));
}

function buildCounts(cards: CardIndexEntry[]): CountRow[] {
  const has = (c: CardIndexEntry, sub: string) => c.subtypes.includes(sub);

  const pokemon = cards.filter((c) => c.supertype === "Pokémon").length;
  const supporter = cards.filter((c) => has(c, "Supporter")).length;
  const item = cards.filter((c) => has(c, "Item")).length;
  // "Pokémon Tool F" is a distinct subtype string but the same category.
  const tool = cards.filter((c) =>
    c.subtypes.some((s) => s.startsWith("Pokémon Tool")),
  ).length;
  const stadium = cards.filter((c) => has(c, "Stadium")).length;
  const energyCards = cards.filter((c) => c.supertype === "Energy");
  const specialEnergy = energyCards.filter((c) => has(c, "Special")).length;
  const basicEnergy = energyCards.length - specialEnergy;
  // Cross-cutting: an ACE SPEC is also an Item/Tool/Supporter/Energy, so
  // this deliberately overlaps the rows above rather than partitioning.
  const aceSpec = cards.filter((c) => has(c, "ACE SPEC")).length;

  return [
    { label: "Pokémon", count: pokemon },
    { label: "Supporter", count: supporter },
    { label: "Item", count: item },
    { label: "Tool", count: tool },
    { label: "Stadium", count: stadium },
    { label: "Energy", count: basicEnergy },
    { label: "Special Energy", count: specialEnergy },
    { label: "ACE SPEC", count: aceSpec },
    // Drop empty categories — a list of Pokémon shouldn't advertise
    // "Stadium 0".
  ].filter((row) => row.count > 0);
}

export default function ListDetails({ cards }: { cards: CardIndexEntry[] }) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    const sets = new Set(cards.map((c) => c.setId));
    const artists = new Set(
      cards.map((c) => c.artist).filter((a): a is string => !!a),
    );
    const marketPrice = cards.reduce((sum, c) => sum + (c.marketPrice || 0), 0);

    const presentTypes = new Set<string>();
    for (const c of cards) for (const t of energyTypesFor(c)) presentTypes.add(t);
    const energyTypes = TYPE_ORDER.filter((t) => presentTypes.has(t));

    return {
      cardCount: cards.length,
      setCount: sets.size,
      artistCount: artists.size,
      marketPrice,
      energyTypes,
      counts: buildCounts(cards),
    };
  }, [cards]);

  return (
    <div className="mb-4 rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-text-primary">List details</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 shrink-0 text-text-muted transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>

      {/* grid-rows-[0fr] → [1fr] height animation, the repo's standard
          collapse idiom (see MatchForm / DeckProfileView). */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 space-y-4">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Cards" value={String(stats.cardCount)} />
              <Stat label={stats.setCount === 1 ? "Set" : "Sets"} value={String(stats.setCount)} />
              <Stat
                label={stats.artistCount === 1 ? "Artist" : "Artists"}
                value={String(stats.artistCount)}
              />
              <Stat label="Market price" value={`$${stats.marketPrice.toFixed(2)}`} />
            </dl>

            {stats.energyTypes.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-1.5">
                  Energy
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {stats.energyTypes.map((t) => {
                    const url = typeIconUrl(t);
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={t} src={url} alt={t} title={t} width={22} height={22} />
                    ) : (
                      <span key={t} className="text-xs text-text-secondary">
                        {t}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {stats.counts.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide font-semibold text-text-muted mb-1.5">
                  Breakdown
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.counts.map((row) => (
                    <span
                      key={row.label}
                      className="inline-flex items-baseline gap-1.5 rounded-full border border-black/10 dark:border-white/10 bg-surface px-2.5 py-1 text-xs"
                    >
                      <span className="font-semibold text-text-primary tabular-nums">
                        {row.count}
                      </span>
                      <span className="text-text-secondary">{row.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </dt>
      <dd className="text-base font-semibold text-text-primary tabular-nums">{value}</dd>
    </div>
  );
}
