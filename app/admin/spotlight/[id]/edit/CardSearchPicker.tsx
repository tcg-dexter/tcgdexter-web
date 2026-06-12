"use client";

import { useRef, useState } from "react";
import type { SpotlightCardRef } from "@/app/spotlight/types";
import { cardImageSmall } from "@/lib/cardImages";

interface CardHit {
  name: string;
  set_id: string;
  set_name: string;
  number: string;
  image_url: string;
}

interface Props {
  label: string;
  value: SpotlightCardRef;
  onChange: (v: SpotlightCardRef) => void;
}

const inputClass =
  "w-full px-3 py-2 text-sm rounded-lg border border-black/15 bg-white";

export default function CardSearchPicker({ label, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSelection = Boolean(value.set_id || value.number || value.name);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(val.trim())}`);
        const json = await res.json();
        setResults((json.cards as CardHit[]) ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
  }

  function select(card: CardHit) {
    onChange({ set_id: card.set_id, number: card.number, name: card.name });
    setQuery("");
    setResults([]);
  }

  function clear() {
    onChange({ set_id: "", number: "", name: "" });
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
        {label}
      </div>

      {hasSelection && (
        <div className="flex items-center gap-3 mb-2 p-2 rounded-lg border border-black/10 bg-[var(--surface)]">
          {value.set_id && value.number && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cardImageSmall(value.set_id, value.number)}
              alt=""
              className="w-10 h-14 object-contain rounded flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary truncate">
              {value.name || "—"}
            </div>
            <div className="text-xs text-text-muted">
              {value.set_id} · {value.number}
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            className="text-xs text-text-muted hover:text-accent flex-shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      <div className="relative">
        <input
          value={query}
          onChange={handleChange}
          placeholder={hasSelection ? "Search to replace…" : "Search by card name…"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={inputClass}
        />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg divide-y divide-black/5">
            {results.map((c) => (
              <li key={`${c.set_id}-${c.number}`}>
                <button
                  type="button"
                  onClick={() => select(c)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-black/[0.03] transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.image_url}
                    alt=""
                    className="w-8 h-11 object-contain rounded flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{c.name}</div>
                    <div className="text-xs text-text-muted truncate">
                      {c.set_name} · {c.number}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searching && <p className="mt-1 text-xs text-text-muted">Searching…</p>}
        {!searching && query.trim() && results.length === 0 && (
          <p className="mt-1 text-xs text-text-muted">No cards found for &ldquo;{query}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}
