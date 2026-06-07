"use client";

import { useEffect, useRef, useState } from "react";
import { cardImageSmall } from "@/lib/cardImages";
import type { SpotlightCardRef } from "@/app/spotlight/types";

interface CardResult {
  name: string;
  set_id: string;
  set_name: string | null;
  number: string;
  supertype: string | null;
  types: string[];
  rarity: string | null;
}

interface SlotDef {
  key: string;
  label: string;
  value: SpotlightCardRef | null;
  onChange: (v: SpotlightCardRef | null) => void;
}

interface Props {
  slots: SlotDef[];
}

/**
 * Shared card search that drives multiple slot assignments. The admin types
 * once; each result has an inline button per slot ("Set as <label>") that
 * assigns it to that slot. Selected cards display above the search as
 * removable chips per slot.
 */
export default function CardSearchPicker({ slots }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const val = query.trim();
    if (val.length < 2) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/spotlight/card-search?q=${encodeURIComponent(val)}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Search failed");
        setResults(json.results as CardResult[]);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function assign(slot: SlotDef, card: CardResult) {
    slot.onChange({
      name: card.name,
      set_id: card.set_id,
      number: card.number,
    });
  }

  return (
    <div className="space-y-3">
      {/* Selected chips per slot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {slots.map((slot) => (
          <SlotChip key={slot.key} slot={slot} />
        ))}
      </div>

      {/* Shared search */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards by name (min 2 chars)…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-black/15 bg-white"
          autoComplete="off"
        />
      </div>

      {/* Results */}
      {query.trim().length >= 2 && (
        <div className="rounded-lg border border-black/10 bg-white max-h-96 overflow-y-auto">
          {searching ? (
            <div className="px-3 py-3 text-xs text-text-muted">Searching…</div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-accent">{error}</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-muted">
              No cards match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <ul className="divide-y divide-black/8">
              {results.map((c) => (
                <ResultRow
                  key={`${c.set_id}-${c.number}`}
                  card={c}
                  slots={slots}
                  onAssign={assign}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SlotChip({ slot }: { slot: SlotDef }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
        {slot.label}
      </div>
      {slot.value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardImageSmall(slot.value.set_id, slot.value.number)}
            alt={slot.value.name}
            className="w-12 h-[68px] object-contain rounded bg-[var(--surface)] shrink-0"
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary truncate">
              {slot.value.name}
            </div>
            <div className="text-[11px] text-text-muted">
              {slot.value.set_id.toUpperCase()} · {slot.value.number}
            </div>
          </div>
          <button
            type="button"
            onClick={() => slot.onChange(null)}
            className="text-xs text-text-muted hover:text-accent shrink-0"
          >
            Clear
          </button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">No card selected.</p>
      )}
    </div>
  );
}

function ResultRow({
  card,
  slots,
  onAssign,
}: {
  card: CardResult;
  slots: SlotDef[];
  onAssign: (slot: SlotDef, card: CardResult) => void;
}) {
  function isSelected(slot: SlotDef) {
    return (
      slot.value?.set_id === card.set_id && slot.value?.number === card.number
    );
  }
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cardImageSmall(card.set_id, card.number)}
        alt={card.name}
        className="w-10 h-[56px] object-contain rounded bg-[var(--surface)] shrink-0"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary truncate">
          {card.name}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {card.set_name ?? card.set_id.toUpperCase()} · {card.number}
          {card.supertype ? ` · ${card.supertype}` : ""}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {slots.map((slot) => {
          const selected = isSelected(slot);
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => onAssign(slot, card)}
              disabled={selected}
              className={`text-[11px] font-semibold px-2 py-1 rounded-md border whitespace-nowrap ${
                selected
                  ? "border-emerald-500 text-emerald-600 bg-emerald-50 cursor-default"
                  : "border-black/15 text-text-primary hover:border-accent hover:text-accent"
              }`}
            >
              {selected ? `✓ ${slot.label}` : `Set as ${slot.label}`}
            </button>
          );
        })}
      </div>
    </li>
  );
}
