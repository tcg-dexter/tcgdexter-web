"use client";

import { useMemo, useState } from "react";
import { COLLECTION_VARIANTS } from "@/lib/inventory";
import { normalizeForSearch } from "@/lib/searchNormalize";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import type { OwnershipFilter } from "@/lib/cardSearch";
import { useInventory } from "./InventoryContext";
import { GridView, ListView } from "./CardCollectionView";

/**
 * Filter-panel widgets and the ownership-scoped results view shared by the
 * card catalog (CardsClient.tsx) and the list-detail page
 * (ListDetailClient.tsx) — extracted so both toolbars behave identically
 * instead of maintaining two copies of the same filter chips.
 */

export function OwnershipRadios({
  value,
  onChange,
}: {
  value: OwnershipFilter;
  onChange: (v: OwnershipFilter) => void;
}) {
  const options: Array<{ key: OwnershipFilter; label: string }> = [
    { key: "all", label: "All Cards" },
    { key: "owned", label: "Owned" },
    { key: "unowned", label: "Unowned" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Ownership scope"
      className="flex items-center gap-4 mb-4"
    >
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <label
            key={o.key}
            className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-text-secondary"
          >
            <input
              type="radio"
              name="ownership"
              value={o.key}
              checked={selected}
              onChange={() => onChange(o.key)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                selected
                  ? "border-accent bg-white dark:bg-surface-elevated"
                  : "border-black/25 dark:border-white/25 bg-white dark:bg-surface-elevated peer-hover:border-black/50 dark:peer-hover:border-white/50"
              }`}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
            <span className={selected ? "text-text-primary" : ""}>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function FacetGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-black dark:bg-white text-white dark:text-black border-transparent"
                  : "bg-white dark:bg-surface-2 text-text-secondary border-black/10 hover:bg-surface"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SetFacet({
  sets,
  selected,
  onToggle,
}: {
  sets: Array<{ id: string; name: string; ptcgoCode: string | null }>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = normalizeForSearch(filter.trim());
    if (!f) return sets;
    return sets.filter(
      (s) =>
        normalizeForSearch(s.name).includes(f) ||
        (s.ptcgoCode ? normalizeForSearch(s.ptcgoCode).includes(f) : false)
    );
  }, [sets, filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-text-secondary">Set</div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sets…"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 w-40"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {filtered.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-black dark:bg-white text-white dark:text-black border-transparent"
                  : "bg-white dark:bg-surface-2 text-text-secondary border-black/10 hover:bg-surface"
              }`}
              title={s.id}
            >
              {s.ptcgoCode && (
                <span className="font-bold mr-1">{s.ptcgoCode}</span>
              )}
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RangeFacet({
  label,
  min,
  max,
  step = 10,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-2">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={step}
          value={min ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value), max)}
          placeholder="Min"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 w-24"
        />
        <span className="text-xs text-text-muted">to</span>
        <input
          type="number"
          step={step}
          value={max ?? ""}
          onChange={(e) => onChange(min, e.target.value === "" ? undefined : Number(e.target.value))}
          placeholder="Max"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 w-24"
        />
      </div>
    </div>
  );
}

/**
 * Renders cards as grid/list, additionally narrowed by which inventory
 * variant(s) they're owned in (the "Variant" facet, only meaningful when
 * ownership scope is "owned" — the caller passes [] otherwise).
 */
export function VariantFilteredView({
  cards,
  variantFilter,
  view,
}: {
  cards: CardIndexEntry[];
  variantFilter: string[];
  view: "grid" | "list";
}) {
  const { presentVariants } = useInventory();
  const displayed = useMemo(() => {
    if (variantFilter.length === 0) return cards;
    return cards.filter((c) =>
      presentVariants(c.setId, c.number).some((v) =>
        variantFilter.includes(COLLECTION_VARIANTS.find((x) => x.key === v)?.label ?? "")
      )
    );
  }, [cards, variantFilter, presentVariants]);

  if (displayed.length === 0) {
    return (
      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
        <p className="text-sm text-text-secondary">No cards match these filters.</p>
      </div>
    );
  }
  return view === "grid" ? <GridView cards={displayed} /> : <ListView cards={displayed} />;
}
