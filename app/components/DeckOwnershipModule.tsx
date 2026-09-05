"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export interface OwnableCard {
  name: string;
  qty: number;
  /** Every (setId, number) printing of this card name in the standard DB. */
  printings: { setId: string; number: string }[];
  /** The deck's specific printing + default variant, for adding to the
   *  catalog. Null when the printing can't be resolved. */
  add?: { setId: string; number: string; variant: string } | null;
}

interface CollectionItem {
  setId: string;
  number: string;
  variant: string;
  quantity: number;
}

interface AddItem {
  setId: string;
  number: string;
  variant: string;
  delta: number;
}

interface Props {
  cards: OwnableCard[];
}

const CARD_CLS =
  "rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5";

type State = "loading" | "signedOut" | "empty" | "owned";
type AddMode = "off" | "options" | "manual";
type ConfirmKind = "all" | "unowned" | "manual";

/**
 * "Cards Owned" module. Always present on a deck profile, but situational:
 *
 *  - signed out / collection load error → CTA to explore the Card Catalog
 *  - signed in but no cards tracked yet  → CTA to start a collection
 *  - signed in with a collection         → per-card owned vs. needed plus an
 *    overall percentage, and an "Add Cards to Catalog" flow (add all / add
 *    unowned / manually pick quantities).
 *
 * Ownership matches by card name across any printing/finish the user owns;
 * basic Energy is excluded upstream.
 */
export default function DeckOwnershipModule({ cards }: Props) {
  const [state, setState] = useState<State>("loading");
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [fill, setFill] = useState(0);

  const [addMode, setAddMode] = useState<AddMode>("off");
  const [manualQty, setManualQty] = useState<Record<number, number>>({});
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadCollection = useCallback(async () => {
    const res = await fetch("/api/collection");
    if (res.status === 401 || !res.ok) {
      setState("signedOut");
      return;
    }
    const data = await res.json();
    const items: CollectionItem[] = Array.isArray(data.items) ? data.items : [];
    setCollection(items);
    setState(items.length > 0 ? "owned" : "empty");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadCollection();
      } catch {
        if (!cancelled) setState("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCollection]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // With no tracked cards, auto-expand so the "Add Cards to Catalog" CTA is
  // visible immediately — nudging the user to start a collection.
  useEffect(() => {
    if (state === "empty") setExpanded(true);
  }, [state]);

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

  const unownedTotal = useMemo(
    () => rows.reduce((s, r) => s + Math.max(0, r.qty - r.owned), 0),
    [rows],
  );

  // Animate the progress bar from 0 → target each time the module expands.
  useEffect(() => {
    if (!expanded) {
      setFill(0);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFill(Math.min(100, totals.pct)));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [expanded, totals.pct]);

  const neededCount = cards.reduce((s, c) => s + c.qty, 0);

  // Build the add payload for the pending confirmation.
  function buildItems(kind: ConfirmKind): AddItem[] {
    const out: AddItem[] = [];
    cards.forEach((card, i) => {
      if (!card.add) return;
      let delta = 0;
      if (kind === "all") delta = card.qty;
      else if (kind === "unowned") delta = Math.max(0, card.qty - rows[i].owned);
      else delta = manualQty[i] ?? 0;
      if (delta > 0) {
        out.push({ ...card.add, delta });
      }
    });
    return out;
  }

  const pendingItems = confirm ? buildItems(confirm) : [];
  const pendingCount = pendingItems.reduce((s, it) => s + it.delta, 0);

  async function performAdd() {
    if (!confirm) return;
    const items = buildItems(confirm);
    const count = items.reduce((s, it) => s + it.delta, 0);
    setAdding(true);
    try {
      const res = await fetch("/api/collection/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("add failed");
      await loadCollection();
      setConfirm(null);
      setAddMode("off");
      setManualQty({});
      setToast(`Added ${count} card${count === 1 ? "" : "s"} to your catalog.`);
    } catch {
      setToast("Couldn't add cards — please try again.");
    } finally {
      setAdding(false);
    }
  }

  function enterManual() {
    // Seed each input with the count the user is missing.
    const seed: Record<number, number> = {};
    rows.forEach((r, i) => {
      seed[i] = Math.max(0, r.qty - r.owned);
    });
    setManualQty(seed);
    setAddMode("manual");
  }

  function setQty(i: number, next: number) {
    setManualQty((prev) => ({ ...prev, [i]: Math.max(0, next) }));
  }

  const manualTotal = useMemo(
    () => Object.values(manualQty).reduce((s, n) => s + (n || 0), 0),
    [manualQty],
  );

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

  // ── Signed-out CTA (the only state without the breakdown) ───────────────
  if (state === "signedOut") {
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
          Track your card collection to see how much of any deck you already
          own. Build your collection in Cards and we&apos;ll show exactly how
          many of this deck&apos;s {neededCount} cards you can already put
          together.
        </p>
        <Link
          href="/cards"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
          </svg>
          Open Cards
        </Link>
      </div>
    );
  }

  // ── Owned breakdown ─────────────────────────────────────────────────────
  if (cards.length === 0) return null;

  const pctLabel = `${Math.round(totals.pct)}%`;
  const manualMode = addMode === "manual";

  const confirmTitle =
    confirm === "all"
      ? "Are you sure you want to add all cards?"
      : confirm === "unowned"
        ? "Are you sure you want to add all unowned cards?"
        : "Add these cards to your collection?";

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
          <span className="text-lg font-bold tabular-nums text-text-primary">
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
              className="h-full rounded-full bg-gradient-brand transition-[width] duration-700 ease-out"
              style={{ width: `${fill}%` }}
            />
          </div>

          {/* Add Cards to Catalog — engages an inline options row. */}
          {addMode === "off" && (
            <button
              type="button"
              onClick={() => setAddMode("options")}
              className="mb-4 w-full inline-flex items-center justify-center gap-2 rounded-full border border-black/15 bg-white dark:bg-surface-2 py-2.5 text-sm font-semibold text-text-primary hover:bg-black/[0.03] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Cards to Catalog
            </button>
          )}

          {addMode === "options" && (
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm("all")}
                  className="flex-1 min-w-[8rem] rounded-full bg-black dark:bg-white px-3 py-2 text-xs font-semibold text-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85 transition-colors"
                >
                  Add all cards
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm("unowned")}
                  disabled={unownedTotal === 0}
                  className="flex-1 min-w-[8rem] rounded-full bg-black dark:bg-white px-3 py-2 text-xs font-semibold text-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85 transition-colors disabled:opacity-40"
                >
                  Add unowned cards
                </button>
                <button
                  type="button"
                  onClick={enterManual}
                  className="flex-1 min-w-[8rem] rounded-full border border-black/15 bg-white dark:bg-surface-2 px-3 py-2 text-xs font-semibold text-text-primary hover:bg-black/[0.03] transition-colors"
                >
                  Manually select
                </button>
              </div>
              <button
                type="button"
                onClick={() => setAddMode("off")}
                className="self-start text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Column headers */}
          <div className="flex items-center gap-3 pb-1.5 mb-1.5 border-b border-black/5 dark:border-white/10 text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white">
            <span className="flex-1" />
            {manualMode ? (
              <span className="w-[7.5rem] text-right">Add</span>
            ) : (
              <>
                <span className="w-16 text-right">Owned</span>
                <span className="w-16 text-right">In Deck</span>
              </>
            )}
          </div>

          <ul className="space-y-1.5">
            {rows.map((r, i) => {
              const tone = r.owned >= r.qty ? "text-black dark:text-white" : "text-accent";
              const canAdd = !!cards[i].add;
              return (
                <li key={`${r.name}-${i}`} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex-1 min-w-0 truncate text-text-secondary ${
                      r.owned >= r.qty ? "" : "italic"
                    }`}
                  >
                    {r.name}
                  </span>

                  {manualMode ? (
                    <div className="w-[7.5rem] flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(i, (manualQty[i] ?? 0) - 1)}
                        disabled={!canAdd || (manualQty[i] ?? 0) <= 0}
                        aria-label={`Remove one ${r.name}`}
                        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/15 bg-white dark:bg-surface-2 text-text-primary hover:bg-black/[0.03] transition-colors disabled:opacity-30"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQty(i, (manualQty[i] ?? 0) + 1)}
                        disabled={!canAdd}
                        aria-label={`Add one ${r.name}`}
                        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/15 bg-white dark:bg-surface-2 text-text-primary hover:bg-black/[0.03] transition-colors disabled:opacity-30"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={canAdd ? (manualQty[i] ?? 0) : 0}
                        disabled={!canAdd}
                        onChange={(e) => setQty(i, parseInt(e.target.value || "0", 10) || 0)}
                        className="w-10 rounded-md border border-black/15 dark:border-white/10 bg-bg px-1 py-1 text-right tabular-nums text-text-primary focus:outline-none focus:border-accent/40 disabled:opacity-40 [font-size:16px] sm:text-sm"
                      />
                    </div>
                  ) : (
                    <>
                      <span className={`w-16 text-right tabular-nums font-semibold ${tone}`}>
                        {r.owned}
                      </span>
                      <span className="w-16 text-right tabular-nums font-semibold text-text-primary">
                        {r.qty}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {manualMode ? (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirm("manual")}
                disabled={manualTotal === 0}
                className="inline-flex items-center justify-center rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-40"
              >
                Add cards
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddMode("off");
                  setManualQty({});
                }}
                className="text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-text-muted">
              {totals.have} of {totals.needed} cards owned (basic Energy excluded).
            </p>
          )}
        </>
      )}

      {/* Confirmation dialog */}
      {confirm && typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => !adding && setConfirm(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-semibold text-text-primary">
                {confirmTitle}
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                {pendingCount > 0
                  ? `${pendingCount} card${pendingCount === 1 ? "" : "s"} will be added to your catalog.`
                  : "Nothing to add."}
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  disabled={adding}
                  className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={performAdd}
                  disabled={adding || pendingCount === 0}
                  className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50"
                >
                  {adding ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Success / error toast */}
      {toast && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
            {toast}
          </div>,
          document.body,
        )}
    </div>
  );
}
