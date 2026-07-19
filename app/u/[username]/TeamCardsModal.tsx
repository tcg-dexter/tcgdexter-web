"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cardImageSmall } from "@/lib/cardImages";
import type { TeamCardRef } from "./TeamCards";

interface SearchResult {
  name: string;
  set_id: string;
  set_name: string | null;
  number: string;
}

interface Props {
  initial: (TeamCardRef | null)[];
  onClose: () => void;
}

const SLOTS = 7;
const SEARCH_DEBOUNCE_MS = 250;

function normalize(team: (TeamCardRef | null)[]): (TeamCardRef | null)[] {
  const out: (TeamCardRef | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

/**
 * "Select Banner Cards" modal, opened from the banner pencil menu
 * (AccentPicker). Search + pick fills a target slot: clicking a slot
 * thumbnail (filled or empty) sets it as the target; with no target set,
 * a pick fills the first empty slot. Nothing is persisted until Save.
 */
export default function TeamCardsModal({ initial, onClose }: Props) {
  const [team, setTeam] = useState<(TeamCardRef | null)[]>(() => normalize(initial));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const val = value.trim();
    if (val.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setResults(res.ok ? (json.results as SearchResult[]) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function pickCard(card: SearchResult) {
    const targetIdx = activeSlot ?? team.findIndex((s) => s === null);
    if (targetIdx === -1) return;
    const next = [...team];
    next[targetIdx] = { name: card.name, set_id: card.set_id, number: card.number };
    setTeam(next);
    const nextEmpty = next.findIndex((s, i) => s === null && i > targetIdx);
    setActiveSlot(nextEmpty !== -1 ? nextEmpty : null);
  }

  function removeSlot(i: number) {
    const next = [...team];
    next[i] = null;
    setTeam(next);
    setActiveSlot(i);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_cards: team }),
      });
      if (!res.ok) {
        setError("Couldn't save. Try again.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const filledCount = team.filter(Boolean).length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Select banner cards"
        className="relative z-10 flex w-full max-w-lg max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/8 shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Select Banner Cards</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-full text-text-muted hover:bg-bg hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {team.map((card, i) => (
                <SlotThumb
                  key={i}
                  card={card}
                  active={activeSlot === i}
                  onClick={() => setActiveSlot(i)}
                  onRemove={() => removeSlot(i)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {filledCount} / {SLOTS} selected
              {activeSlot !== null ? ` — picking slot ${activeSlot + 1}` : ""}
            </p>
          </div>

          <div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search cards by name…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full rounded-lg border border-black/10 bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
            />
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-black/8">
              {query.trim().length < 2 ? (
                <p className="px-3 py-3 text-xs text-text-muted">Type at least 2 characters…</p>
              ) : searching ? (
                <p className="px-3 py-3 text-xs text-text-muted">Searching…</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-xs text-text-muted">No matches.</p>
              ) : (
                <ul className="divide-y divide-black/8">
                  {results.map((c) => (
                    <li key={`${c.set_id}-${c.number}`}>
                      <button
                        type="button"
                        onClick={() => pickCard(c)}
                        className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-bg transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cardImageSmall(c.set_id, c.number)}
                          alt=""
                          loading="lazy"
                          className="w-8 h-[44px] object-contain rounded bg-surface shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-text-primary truncate">
                            {c.name}
                          </span>
                          <span className="block text-[11px] text-text-muted truncate">
                            {c.set_name ?? c.set_id.toUpperCase()} · {c.number}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-black/8 shrink-0">
          {error && <p className="mr-auto text-xs text-accent">{error}</p>}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-black/10 text-text-secondary hover:bg-bg transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SlotThumb({
  card,
  active,
  onClick,
  onRemove,
}: {
  card: TeamCardRef | null;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const ring = active ? "ring-2 ring-offset-1 ring-accent" : "";
  if (card) {
    return (
      <div className={`relative aspect-[245/342] rounded-lg overflow-hidden ${ring}`}>
        <button
          type="button"
          onClick={onClick}
          aria-label={`Replace ${card.name}`}
          title={card.name}
          className="absolute inset-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardImageSmall(card.set_id, card.number)}
            alt=""
            className="w-full h-full object-cover"
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${card.name}`}
          className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none hover:bg-black/80"
        >
          ✕
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Empty slot"
      className={`aspect-[245/342] rounded-lg border-2 border-dashed border-black/15 flex items-center justify-center text-text-muted hover:border-accent hover:text-accent transition-colors ${ring}`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
      </svg>
    </button>
  );
}
