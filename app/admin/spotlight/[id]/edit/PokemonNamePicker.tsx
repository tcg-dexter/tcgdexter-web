"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pokemonSlug } from "@/lib/primaryCardImage";
import { normalizeForSearch } from "@/lib/searchNormalize";
import type { SpotlightPokemonRef } from "@/app/spotlight/types";

interface Props {
  value: SpotlightPokemonRef | null;
  onChange: (v: SpotlightPokemonRef | null) => void;
}

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";
const RESULT_LIMIT = 60;

/**
 * Single-slot Pokémon avatar picker for the spotlight editor. Mirrors the
 * TeamOfSix popover pattern: click the slot to open a search popover that
 * filters /pokemon-names.json on first type. Stores just the name; the
 * displayed image is a sprite, not a card.
 */
export default function PokemonNamePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ensureNames() {
    if (names) return;
    try {
      const res = await fetch("/pokemon-names.json", { cache: "force-cache" });
      if (res.ok) setNames((await res.json()) as string[]);
    } catch {
      /* ignore — empty results below */
    }
  }

  function handleQueryChange(v: string) {
    setQuery(v);
    if (v.trim().length > 0) ensureNames();
  }

  function pick(name: string) {
    onChange({ name });
    setOpen(false);
    setQuery("");
  }

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed || !names) return [];
    const q = normalizeForSearch(trimmed);
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const n of names) {
      const lower = normalizeForSearch(n);
      if (lower.startsWith(q)) prefix.push(n);
      else if (lower.includes(q)) sub.push(n);
      if (prefix.length + sub.length >= RESULT_LIMIT * 2) break;
    }
    return [...prefix, ...sub].slice(0, RESULT_LIMIT);
  }, [names, trimmed]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-20 h-20 rounded-full border-2 border-black/15 bg-[var(--surface)] flex items-center justify-center overflow-hidden shadow-sm hover:border-accent"
          aria-label={value ? `Change favorite Pokémon (${value.name})` : "Pick favorite Pokémon"}
        >
          {value ? (
            <Sprite name={value.name} className="w-3/4 h-3/4" />
          ) : (
            <svg
              className="w-8 h-8 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
            </svg>
          )}
        </button>
        {value && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary">{value.name}</div>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-xs text-text-muted hover:text-accent"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Pick a Pokémon"
          className="absolute left-0 top-full mt-2 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-black/8 bg-white shadow-xl p-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search Pokémon…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {trimmed && !names ? (
              <p className="text-xs text-text-muted px-2 py-3">Loading…</p>
            ) : !trimmed ? (
              <p className="text-xs text-text-muted px-2 py-3">Start typing to search.</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-text-muted px-2 py-3">No matches.</p>
            ) : (
              <ul className="grid grid-cols-1">
                {results.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => pick(n)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg"
                    >
                      <Sprite name={n} size={28} />
                      <span className="text-sm text-text-primary truncate">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Sprite({
  name,
  size,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  if (errored) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-surface text-text-secondary font-semibold ${className ?? ""}`}
        style={style}
        aria-hidden
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={`${SPRITE_BASE}/${pokemonSlug(name)}.png`}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      className={`object-contain ${className ?? ""}`}
      style={style}
      onError={() => setErrored(true)}
    />
  );
}
