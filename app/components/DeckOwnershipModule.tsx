"use client";

import { useEffect, useMemo, useState } from "react";

export interface OwnableCard {
  name: string;
  qty: number;
  /** Every (setId, number) printing of this card name in the standard DB. */
  printings: { setId: string; number: string }[];
}

interface CollectionItem {
  setId: string;
  number: string;
  variant: string;
  quantity: number;
}

interface Props {
  cards: OwnableCard[];
}

const CARD_CLS =
  "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5";

/**
 * "Cards Owned" module. For each non-basic-energy card in the deck, counts how
 * many copies the signed-in user owns (any printing of the same card name,
 * summed across finishes) and shows owned vs. needed plus an overall
 * percentage of the deck the user can already build.
 *
 * Renders nothing for signed-out users or users with an empty collection —
 * the comparison is only meaningful when there's a tracked collection.
 */
export default function DeckOwnershipModule({ cards }: Props) {
  const [collection, setCollection] = useState<CollectionItem[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/collection");
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setCollection(Array.isArray(data.items) ? data.items : []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Owned quantity per "setId|number", summed across finishes.
  const ownedByPrinting = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of collection ?? []) {
      const key = `${item.setId}|${item.number}`;
      map.set(key, (map.get(key) ?? 0) + item.quantity);
    }
    return map;
  }, [collection]);

  const rows = useMemo(() => {
    return cards.map((card) => {
      let owned = 0;
      for (const p of card.printings) {
        owned += ownedByPrinting.get(`${p.setId}|${p.number}`) ?? 0;
      }
      return { name: card.name, qty: card.qty, owned: Math.min(owned, card.qty) };
    });
  }, [cards, ownedByPrinting]);

  const totals = useMemo(() => {
    const needed = rows.reduce((s, r) => s + r.qty, 0);
    const have = rows.reduce((s, r) => s + r.owned, 0);
    return { needed, have, pct: needed > 0 ? (have / needed) * 100 : 0 };
  }, [rows]);

  // Hide until we know the collection, for signed-out users, and for users
  // who track no collection at all (nothing meaningful to compare against).
  if (!loaded || !collection || collection.length === 0) return null;
  if (cards.length === 0) return null;

  const pctLabel = `${Math.round(totals.pct)}%`;
  const overallTone =
    totals.pct >= 100
      ? "text-emerald-700"
      : totals.pct >= 50
        ? "text-amber-600"
        : "text-text-secondary";

  return (
    <div className={CARD_CLS}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Cards Owned</h2>
        <span className={`text-lg font-bold tabular-nums ${overallTone}`}>
          {pctLabel}
        </span>
      </div>

      {/* Overall progress bar */}
      <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden mb-4">
        <div
          className="h-full rounded-full bg-gradient-brand transition-[width] duration-500"
          style={{ width: `${Math.min(100, totals.pct)}%` }}
        />
      </div>

      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const complete = r.owned >= r.qty;
          const tone = complete
            ? "text-emerald-700"
            : r.owned > 0
              ? "text-amber-600"
              : "text-text-muted";
          return (
            <li
              key={`${r.name}-${i}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate text-text-secondary">
                {r.name}
              </span>
              <span className={`shrink-0 tabular-nums font-semibold ${tone}`}>
                {r.owned}/{r.qty}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-text-muted">
        {totals.have} of {totals.needed} cards owned (basic Energy excluded).
      </p>
    </div>
  );
}
