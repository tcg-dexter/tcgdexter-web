import { Sparkline } from "./Card";
import type { ProductRow } from "../lib/analytics";
import { PRODUCT_BAR, PRODUCT_CHIP, PRODUCT_STROKE } from "../lib/products";

// Per-event labels reused beneath each Product card so the underlying
// instrumentation is still visible without dominating the page.
const EVENT_LABELS: Record<string, string> = {
  "analyze.completed": "Analyzed a deck",
  "deck.saved": "Saved a deck",
  "deck.shared": "Shared a deck",
  "deck.renamed": "Renamed a deck",
  "deck.edited": "Edited a deck",
  "deck.deleted": "Deleted a deck",
  "deck.published": "Published a deck",
  "deck.unpublished": "Unpublished a deck",
  "deck.updated": "Updated a deck",
  "match.logged": "Logged a match",
  "meta.deck.saved": "Saved a meta deck",
  "meta.deck.shared": "Shared a meta deck",
};

function DeltaChip({
  delta,
  deltaPct,
}: {
  delta: number;
  deltaPct: number | null;
}) {
  if (delta === 0 && (deltaPct == null || deltaPct === 0)) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
        – flat
      </span>
    );
  }
  const up = delta > 0;
  const label =
    deltaPct != null
      ? `${up ? "+" : ""}${deltaPct.toFixed(0)}%`
      : `${up ? "+" : ""}${delta}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {label.replace(/^-/, "")}
    </span>
  );
}

export default function ProductAdoptionList({ rows }: { rows: ProductRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No Product activity in this window yet.
      </p>
    );
  }

  const maxFires = Math.max(0, ...rows.map((r) => r.fireCount));

  // Sort: instrumented first (highlights or fires), then uninstrumented in
  // PRODUCTS order so the gaps are easy to scan.
  const sorted = [...rows].sort((a, b) => {
    if (a.instrumented !== b.instrumented) return a.instrumented ? -1 : 1;
    return b.fireCount - a.fireCount;
  });

  return (
    <div className="flex flex-col divide-y divide-black/5">
      {sorted.map((r) => {
        const chip = PRODUCT_CHIP[r.productKey];
        const barClass = PRODUCT_BAR[r.productKey];
        const stroke = PRODUCT_STROKE[r.productKey];
        const widthPct = maxFires > 0 ? (r.fireCount / maxFires) * 100 : 0;
        const hasEvents = r.events.length > 0;
        return (
          <div key={r.productKey} className="py-5">
            {/* Identity row */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={`shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ${chip}`}
              >
                Product
              </span>
              <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {r.label}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {r.description}
              </span>
            </div>

            {/* Primary content — highlights are the lead. They lift the
                Product card from "what events fired" to "what's actually
                going on in this surface". When a Product has no domain
                stats wired up, fall through to the empty state. */}
            {r.highlights.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {r.highlights.map((h, i) => (
                  <div key={i} className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {h.label}
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)] sm:text-2xl">
                      {h.value}
                    </div>
                    {h.hint && (
                      <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                        {h.hint}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : !r.instrumented ? (
              <div className="mt-3">
                <span className="inline-flex items-center rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Not yet instrumented
                </span>
              </div>
            ) : null}

            {/* Engagement strip — only renders when the Product has events
                attached. Highlight-only Products (Card Catalog, Deck
                Collection's domain side) skip this; it's reserved for
                surfaces with a live event stream. */}
            {hasEvents && (
              <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[1.4fr_auto]">
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <Sparkline values={r.weekly} width={80} height={24} stroke={stroke} />
                </div>
                <div className="text-right tabular-nums">
                  <div className="flex items-center justify-end gap-1.5">
                    <DeltaChip
                      delta={r.fireCountDelta}
                      deltaPct={r.fireCountDeltaPct}
                    />
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {r.fireCount.toLocaleString()}
                      <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                        event fires
                      </span>
                    </div>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {r.userCount.toLocaleString()} users
                    <span className="text-[var(--text-muted)]"> · </span>
                    {r.events.length}{" "}
                    {r.events.length === 1 ? "event" : "events"}
                  </div>
                </div>
              </div>
            )}

            {/* Underlying events — visible so the Product roll-up never
                hides which lever moved. */}
            {hasEvents && (
              <div className="mt-3 ml-[2px] grid gap-1 pl-3 text-[11px] sm:grid-cols-2">
                {r.events.map((e) => {
                  const label = EVENT_LABELS[e.eventName] ?? e.eventName;
                  return (
                    <div
                      key={e.eventName}
                      className="flex items-center justify-between gap-3 text-[var(--text-secondary)]"
                    >
                      <span className="truncate">
                        <span className="text-[var(--text-primary)]">{label}</span>
                        <span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">
                          {e.eventName}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--text-primary)]">
                        {e.fireCount.toLocaleString()}
                        <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                          fires
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
