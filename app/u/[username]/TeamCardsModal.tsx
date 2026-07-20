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
/** Minimum pointer travel (px) before a press-and-hold on a slot becomes
 *  a drag rather than a tap-to-target. */
const DRAG_THRESHOLD_PX = 6;

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

  // ── Drag-to-reorder ──────────────────────────────────────────
  // Pointer Events (not HTML5 drag-and-drop) so reordering works with
  // touch as well as mouse. dragCandidate tracks a press that *might*
  // become a drag; it's only promoted to an active drag (dragIndex set)
  // once the pointer travels past DRAG_THRESHOLD_PX, so a plain tap
  // still reaches the slot's onClick (tap-to-target) undisturbed.
  const dragCandidate = useRef<{ index: number; x: number; y: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Set right before a real drag's pointerup so the synthetic click that
  // follows (browsers fire one even after a captured drag) doesn't also
  // re-target the slot via onClick.
  const justDraggedRef = useRef(false);

  function handleSlotPointerDown(e: React.PointerEvent<HTMLElement>, i: number) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragCandidate.current = { index: i, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleSlotPointerMove(e: React.PointerEvent<HTMLElement>) {
    const candidate = dragCandidate.current;
    if (!candidate) return;
    if (dragIndex === null) {
      const dx = e.clientX - candidate.x;
      const dy = e.clientY - candidate.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      setDragIndex(candidate.index);
      setOverIndex(candidate.index);
    }
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-slot-index]");
    if (target) {
      const idx = Number(target.dataset.slotIndex);
      if (!Number.isNaN(idx)) setOverIndex(idx);
    }
  }

  // Pointer capture retargets pointerup reliably, but whether the
  // trailing native `click` still reaches the inner button afterward is
  // inconsistent across browsers — so tap-to-target is decided *here*,
  // from the pointerup itself, rather than relying on onClick. onClick
  // stays on the buttons only as a keyboard-activation fallback (see
  // handleSlotClick), guarded by justDraggedRef in case a browser does
  // also fire a synthetic click after a drag.
  function endSlotDrag() {
    const candidate = dragCandidate.current;
    dragCandidate.current = null;
    if (!candidate) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    if (dragIndex !== null) {
      justDraggedRef.current = true;
      const from = dragIndex;
      const to = overIndex ?? from;
      if (to !== from) {
        setTeam((prev) => {
          const next = [...prev];
          [next[from], next[to]] = [next[to], next[from]];
          return next;
        });
        setActiveSlot(null);
      }
    } else {
      setActiveSlot(candidate.index);
    }
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleSlotClick(i: number) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setActiveSlot(i);
  }

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
                  index={i}
                  card={card}
                  active={activeSlot === i}
                  isDragging={dragIndex === i}
                  isDropTarget={dragIndex !== null && overIndex === i && overIndex !== dragIndex}
                  onClick={() => handleSlotClick(i)}
                  onRemove={() => removeSlot(i)}
                  onPointerDown={(e) => handleSlotPointerDown(e, i)}
                  onPointerMove={handleSlotPointerMove}
                  onPointerUp={endSlotDrag}
                  onPointerCancel={endSlotDrag}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {filledCount} / {SLOTS} selected — drag to reorder
              {activeSlot !== null ? `, picking slot ${activeSlot + 1}` : ""}
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
  index,
  card,
  active,
  isDragging,
  isDropTarget,
  onClick,
  onRemove,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  index: number;
  card: TeamCardRef | null;
  active: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onClick: () => void;
  onRemove: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const ring = isDropTarget
    ? "ring-2 ring-offset-1 ring-accent"
    : active
      ? "ring-2 ring-offset-1 ring-accent/60"
      : "";

  return (
    <div
      data-slot-index={index}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`relative aspect-[245/342] rounded-lg cursor-grab active:cursor-grabbing select-none transition-transform ${
        isDragging ? "opacity-50 scale-95" : ""
      } ${ring}`}
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
    >
      {card ? (
        <>
          <button
            type="button"
            onClick={onClick}
            aria-label={`Replace ${card.name}`}
            title={card.name}
            className="absolute inset-0 rounded-lg overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardImageSmall(card.set_id, card.number)}
              alt=""
              draggable={false}
              className="w-full h-full object-cover pointer-events-none"
            />
          </button>
          <button
            type="button"
            onClick={onRemove}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Remove ${card.name}`}
            className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-none hover:bg-black/80"
          >
            ✕
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onClick}
          aria-label="Empty slot"
          className="absolute inset-0 rounded-lg border-2 border-dashed border-black/15 flex items-center justify-center text-text-muted hover:border-accent hover:text-accent transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
