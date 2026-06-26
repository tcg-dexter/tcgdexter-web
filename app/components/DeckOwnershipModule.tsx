"use client";

import Link from "next/link";
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

type State = "loading" | "signedOut" | "empty" | "owned";

/**
 * "Cards Owned" module. Always present on a deck profile, but situational:
 *
 *  - signed out / collection load error → CTA to explore the Card Catalog
 *  - signed in but no cards tracked yet  → CTA to start a collection
 *  - signed in with a collection         → per-card owned vs. needed plus an
 *    overall percentage of the deck the user can already build
 *
 * Ownership matches by card name across any printing/finish the user owns;
 * basic Energy is excluded upstream.
 */
export default function DeckOwnershipModule({ cards }: Props) {
  const [state, setState] = useState<State>("loading");
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/collection");
        if (cancelled) return;
        if (res.status === 401) {
          setState("signedOut");
          return;
        }
        if (!res.ok) {
          setState("signedOut");
          return;
        }
        const data = await res.json();
        const items: CollectionItem[] = Array.isArray(data.items) ? data.items : [];
        setCollection(items);
        setState(items.length > 0 ? "owned" : "empty");
      } catch {
        if (!cancelled) setState("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Owned quantity per "setId|number", summed across finishes.
  const ownedByPrinting = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of collection) {
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

  const neededCount = cards.reduce((s, c) => s + c.qty, 0);

  // ── Loading — stable shell so the module doesn't pop in / shift layout ──
  if (state === "loading") {
    return (
      <div className={CARD_CLS}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cards Owned</h2>
          <span className="text-sm text-text-muted">Checking…</span>
        </div>
      </div>
    );
  }

  // ── CTA states (signed out, or signed in with no tracked cards) ─────────
  if (state === "signedOut" || state === "empty") {
    const lead =
      state === "empty"
        ? "You haven't added any cards to your collection yet."
        : "Track your card collection to see how much of any deck you already own.";
    return (
      <div className={CARD_CLS}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Cards Owned</h2>
          <svg
            className="w-5 h-5 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
            aria-hidden
          >
            <rect x="3" y="5" width="13" height="16" rx="2" />
            <path d="M8 9h6M8 13h6" strokeLinecap="round" />
            <path d="M8 3.5h9A2.5 2.5 0 0 1 19.5 6v12" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed mb-4">
          {lead} Build your collection in the Card Catalog and we&apos;ll show
          exactly how many of this deck&apos;s {neededCount} cards you can
          already put together.
        </p>
        <Link
          href="/cards"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
          </svg>
          Open Card Catalog
        </Link>
      </div>
    );
  }

  // ── Owned breakdown ─────────────────────────────────────────────────────
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
      {/* Collapsed header — percentage + chevron toggle the breakdown. */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3"
      >
        <h2 className="text-lg font-semibold">Cards Owned</h2>
        <span className="flex items-center gap-2">
          <span className={`text-lg font-bold tabular-nums ${overallTone}`}>
            {pctLabel}
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

      {expanded && (
        <>
          {/* Overall progress bar */}
          <div className="mt-3 h-2 rounded-full bg-[var(--surface)] overflow-hidden mb-4">
            <div
              className="h-full rounded-full bg-gradient-brand transition-[width] duration-500"
              style={{ width: `${Math.min(100, totals.pct)}%` }}
            />
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-3 pb-1.5 mb-1.5 border-b border-black/5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <span className="flex-1" />
            <span className="w-16 text-right">Owned</span>
            <span className="w-16 text-right">In Deck</span>
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
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="flex-1 min-w-0 truncate text-text-secondary">
                    {r.name}
                  </span>
                  <span className={`w-16 text-right tabular-nums font-semibold ${tone}`}>
                    {r.owned}
                  </span>
                  <span className="w-16 text-right tabular-nums font-semibold text-text-primary">
                    {r.qty}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-xs text-text-muted">
            {totals.have} of {totals.needed} cards owned (basic Energy excluded).
          </p>
        </>
      )}
    </div>
  );
}
