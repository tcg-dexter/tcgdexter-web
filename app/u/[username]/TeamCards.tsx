"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cardImageLarge, cardImageSmall } from "@/lib/cardImages";

export interface TeamCardRef {
  name: string;
  set_id: string;
  number: string;
}

interface SearchResult {
  name: string;
  set_id: string;
  set_name: string | null;
  number: string;
  supertype: string | null;
}

interface Props {
  initial: (TeamCardRef | null)[];
  isOwner: boolean;
}

const SLOTS = 7;
const SAVE_DEBOUNCE_MS = 700;
const SEARCH_DEBOUNCE_MS = 250;

// Fan geometry — identical to MetaProfileHeader's card fan (see that file
// for the full derivation). Slot count is fixed at SLOTS here (unlike the
// meta header, which fans however many cards it actually has), so every
// position/rotation is a constant computed once below rather than derived
// per-render from a variable card count.
const CARDS_SPAN_PCT = 110.4;
const DESKTOP_CARDS_SPAN_PCT = CARDS_SPAN_PCT * 1.1;
const CARD_WIDTH_PCT = 32;
const BOTTOM_CLIP_PCT = 35;
const CENTER_RAISE_CARD_PCT = 11;
const CARD_MAX_ROTATION_DEG = 12;

interface SlotGeometry {
  left: number;
  leftDesktop: number;
  clipPct: number;
  rotationDeg: number;
  zIndex: number;
}

const SLOT_GEOMETRY: SlotGeometry[] = (() => {
  const cardsLeftStart = (100 - CARDS_SPAN_PCT) / 2;
  const cardsStep = (CARDS_SPAN_PCT - CARD_WIDTH_PCT) / (SLOTS - 1);
  const desktopCardsLeftStart = (100 - DESKTOP_CARDS_SPAN_PCT) / 2;
  const desktopCardsStep = (DESKTOP_CARDS_SPAN_PCT - CARD_WIDTH_PCT) / (SLOTS - 1);
  const center = (SLOTS - 1) / 2;
  const maxDist = center;

  return Array.from({ length: SLOTS }, (_, i) => {
    const signedDist = i - center;
    const normDist = Math.abs(signedDist) / maxDist;
    return {
      left: cardsLeftStart + i * cardsStep,
      leftDesktop: desktopCardsLeftStart + i * desktopCardsStep,
      clipPct: BOTTOM_CLIP_PCT - CENTER_RAISE_CARD_PCT * (1 - normDist * normDist),
      rotationDeg: (signedDist / maxDist) * CARD_MAX_ROTATION_DEG,
      zIndex: i,
    };
  });
})();

/** Pad / trim the persisted array to exactly SLOTS length. */
function normalize(team: (TeamCardRef | null)[]): (TeamCardRef | null)[] {
  const out: (TeamCardRef | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

function slotStyle(g: SlotGeometry): CSSProperties {
  return {
    bottom: 0,
    left: `${g.left}%`,
    "--left-sm": `${g.leftDesktop}%`,
    width: `${CARD_WIDTH_PCT}%`,
    transform: `translateY(${g.clipPct}%) rotate(${g.rotationDeg}deg)`,
    transformOrigin: "50% 100%",
    zIndex: g.zIndex,
  } as CSSProperties;
}

/**
 * 7-card fanned team spread in the user profile banner, echoing the meta
 * archetype header's card fan.
 *
 * - Owner mode: empty slots show a dashed "+" placeholder; tapping opens
 *   a search popover (portaled to `document.body` so it escapes the
 *   banner's `overflow-hidden` fan wrapper). Picking a card fills the
 *   active slot and advances to the next empty one.
 * - Visitor mode: read-only; empty slots render as a dim outline.
 */
export default function TeamCards({ initial, isOwner }: Props) {
  const [team, setTeam] = useState<(TeamCardRef | null)[]>(() => normalize(initial));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Outside-click / Escape / scroll closes the popover. Checks both the
  // fan container and the portaled popover itself, since the popover no
  // longer lives inside containerRef in the DOM.
  useEffect(() => {
    if (activeSlot === null) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onScroll() {
      close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot]);

  useEffect(() => {
    if (activeSlot !== null) inputRef.current?.focus();
  }, [activeSlot]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function close() {
    setActiveSlot(null);
    setQuery("");
    setResults([]);
    setPopoverPos(null);
  }

  function scheduleSave(next: (TeamCardRef | null)[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_cards: next }),
        });
        router.refresh();
      } catch {
        // Optimistic UI already updated; user can re-pick on failure.
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function openSlot(i: number) {
    if (!isOwner) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverPos({ top: rect.bottom + 12, left: rect.left + rect.width / 2 });
    }
    setActiveSlot(i);
    setQuery("");
    setResults([]);
  }

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
    if (activeSlot === null) return;
    const next = [...team];
    next[activeSlot] = { name: card.name, set_id: card.set_id, number: card.number };
    setTeam(next);
    scheduleSave(next);
    // Stay open; advance to the next still-empty slot to streamline
    // multi-pick. If none remain empty, close.
    const nextEmpty = next.findIndex((slot, i) => slot === null && i > activeSlot);
    if (nextEmpty !== -1) {
      openSlot(nextEmpty);
    } else {
      close();
    }
  }

  function clearSlot(i: number) {
    const next = [...team];
    next[i] = null;
    setTeam(next);
    scheduleSave(next);
  }

  return (
    <div ref={containerRef} className="relative h-full mx-6 sm:scale-[0.576] sm:origin-bottom sm:translate-y-[10px] pointer-events-auto">
      {team.map((card, i) => (
        <CardSlot
          key={i}
          card={card}
          geometry={SLOT_GEOMETRY[i]}
          isOwner={isOwner}
          isActive={activeSlot === i}
          onOpen={() => openSlot(i)}
          onClear={() => clearSlot(i)}
        />
      ))}

      {activeSlot !== null &&
        isOwner &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Pick a card"
            className="fixed z-50 w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-black/8 bg-white/95 backdrop-blur-xl shadow-xl p-3"
            style={{ top: popoverPos.top, left: popoverPos.left }}
          >
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
              className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {query.trim().length < 2 ? (
                <p className="text-xs text-text-muted px-2 py-3">
                  Type at least 2 characters…
                </p>
              ) : searching ? (
                <p className="text-xs text-text-muted px-2 py-3">Searching…</p>
              ) : results.length === 0 ? (
                <p className="text-xs text-text-muted px-2 py-3">No matches.</p>
              ) : (
                <ul className="grid grid-cols-1">
                  {results.map((c) => (
                    <li key={`${c.set_id}-${c.number}`}>
                      <button
                        type="button"
                        onClick={() => pickCard(c)}
                        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cardImageSmall(c.set_id, c.number)}
                          alt=""
                          loading="lazy"
                          className="w-7 h-[38px] object-contain rounded bg-surface shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-text-primary truncate">
                            {c.name}
                          </span>
                          <span className="block text-[10px] text-text-muted truncate">
                            {c.set_name ?? c.set_id.toUpperCase()} · {c.number}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ─── CardSlot ──────────────────────────────────────────────── */

function CardSlot({
  card,
  geometry,
  isOwner,
  isActive,
  onOpen,
  onClear,
}: {
  card: TeamCardRef | null;
  geometry: SlotGeometry;
  isOwner: boolean;
  isActive: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  const ring = isActive ? "ring-2 ring-offset-2 ring-white" : "";

  // Visitor + empty slot → dim outline, non-interactive.
  if (!isOwner && !card) {
    return (
      <div
        aria-hidden="true"
        className="absolute aspect-[245/342] rounded-lg border-2 border-dashed border-white/40 sm:[left:var(--left-sm)]"
        style={slotStyle(geometry)}
      />
    );
  }

  if (card) {
    return (
      <button
        type="button"
        onClick={isOwner ? onOpen : undefined}
        onContextMenu={(e) => {
          if (!isOwner) return;
          e.preventDefault();
          onClear();
        }}
        aria-label={isOwner ? `Change slot (${card.name})` : card.name}
        title={isOwner ? `${card.name} — click to change, right-click to clear` : card.name}
        className={`absolute drop-shadow-md sm:[left:var(--left-sm)] ${ring} ${
          isOwner ? "cursor-pointer" : "cursor-default"
        }`}
        style={slotStyle(geometry)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardImageLarge(card.set_id, card.number)}
          alt=""
          className="w-full h-auto pointer-events-none select-none rounded-lg"
        />
      </button>
    );
  }

  // Empty owner slot — dashed placeholder with a plus.
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Add card to team"
      className={`absolute aspect-[245/342] rounded-lg border-2 border-dashed border-white/70 bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors sm:[left:var(--left-sm)] ${ring}`}
      style={slotStyle(geometry)}
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
      </svg>
    </button>
  );
}
