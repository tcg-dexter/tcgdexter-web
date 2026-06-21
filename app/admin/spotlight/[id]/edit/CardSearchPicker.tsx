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
  cards: SpotlightCardRef[];
  setCards: (cards: SpotlightCardRef[]) => void;
  /** Max cards this slot accepts. */
  max: number;
}

interface Props {
  slots: SlotDef[];
}

/**
 * Shared card search backing multiple multi-card slots. The admin types
 * once; each result row carries an inline "Add to <slot>" button per
 * slot. Buttons go disabled when the slot is full or already contains
 * that exact (set_id, number). Selected cards display above the search
 * as small chips with per-card remove.
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
          `/api/admin/spotlight/card-search?q=${encodeURIComponent(val)}`,
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

  function addToSlot(slot: SlotDef, card: CardResult) {
    if (slot.cards.length >= slot.max) return;
    if (
      slot.cards.some(
        (c) => c.set_id === card.set_id && c.number === card.number,
      )
    ) {
      return;
    }
    slot.setCards([
      ...slot.cards,
      { name: card.name, set_id: card.set_id, number: card.number },
    ]);
  }

  function removeFromSlot(slot: SlotDef, index: number) {
    slot.setCards(slot.cards.filter((_, i) => i !== index));
  }

  function setCaptionForSlot(slot: SlotDef, index: number, caption: string) {
    slot.setCards(
      slot.cards.map((c, i) =>
        i === index ? { ...c, caption: caption || null } : c,
      ),
    );
  }

  return (
    <div className="space-y-3">
      {/* Selected chips per slot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {slots.map((slot) => (
          <SlotPanel
            key={slot.key}
            slot={slot}
            onRemove={(i) => removeFromSlot(slot, i)}
            onCaption={(i, v) => setCaptionForSlot(slot, i, v)}
          />
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
                  onAdd={addToSlot}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SlotPanel({
  slot,
  onRemove,
  onCaption,
}: {
  slot: SlotDef;
  onRemove: (index: number) => void;
  onCaption: (index: number, caption: string) => void;
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {slot.label}
        </div>
        <div className="text-[11px] text-text-muted">
          {slot.cards.length} / {slot.max}
        </div>
      </div>
      {slot.cards.length === 0 ? (
        <p className="text-xs text-text-muted">No cards selected.</p>
      ) : (
        <ul className="space-y-3">
          {slot.cards.map((card, i) => (
            <li
              key={`${card.set_id}-${card.number}-${i}`}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cardImageSmall(card.set_id, card.number)}
                  alt={card.name}
                  className="w-8 h-[44px] object-contain rounded bg-[var(--surface)] shrink-0"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text-primary truncate">
                    {card.name}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {card.set_id.toUpperCase()} · {card.number}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-xs text-text-muted hover:text-accent shrink-0"
                  aria-label={`Remove ${card.name}`}
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                value={card.caption ?? ""}
                onChange={(e) => onCaption(i, e.target.value)}
                placeholder="Optional caption (shown under the card)"
                maxLength={140}
                className="w-full px-2.5 py-1.5 text-[11px] rounded-md border border-black/10 bg-white focus:outline-none focus:border-accent"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({
  card,
  slots,
  onAdd,
}: {
  card: CardResult;
  slots: SlotDef[];
  onAdd: (slot: SlotDef, card: CardResult) => void;
}) {
  function status(slot: SlotDef): "added" | "full" | "available" {
    if (
      slot.cards.some(
        (c) => c.set_id === card.set_id && c.number === card.number,
      )
    ) {
      return "added";
    }
    if (slot.cards.length >= slot.max) return "full";
    return "available";
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
          const st = status(slot);
          const disabled = st !== "available";
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => onAdd(slot, card)}
              disabled={disabled}
              className={`text-[11px] font-semibold px-2 py-1 rounded-md border whitespace-nowrap ${
                st === "added"
                  ? "border-emerald-500 text-emerald-600 bg-emerald-50 cursor-default"
                  : st === "full"
                    ? "border-black/10 text-text-muted bg-white cursor-not-allowed"
                    : "border-black/15 text-text-primary hover:border-accent hover:text-accent"
              }`}
            >
              {st === "added"
                ? `✓ ${slot.label}`
                : st === "full"
                  ? `${slot.label} full`
                  : `Add to ${slot.label}`}
            </button>
          );
        })}
      </div>
    </li>
  );
}
