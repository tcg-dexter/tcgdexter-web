"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pokemonSlug } from "@/lib/primaryCardImage";

interface Props {
  initial: (string | null)[];
  isOwner: boolean;
  /** Names shown when the search input is empty. Contextual — derived
   *  from the owner's deck avatars (or top-10 meta fallback) by the
   *  page. Lets users one-tap their familiar Pokémon without needing
   *  to type or load the full names list. */
  defaultSuggestions?: string[];
}

const SLOTS = 6;
const SAVE_DEBOUNCE_MS = 700;
const RESULT_LIMIT = 60;
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

/** Pad / trim the persisted array to exactly SLOTS length. */
function normalize(team: (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(team[i] ?? null);
  return out;
}

function spriteUrl(name: string): string {
  return `${SPRITE_BASE}/${pokemonSlug(name)}.png`;
}

/**
 * 6-slot Pokémon team avatar row in the user profile banner.
 *
 * - Owner mode: empty slots show a `+` placeholder; tapping opens a
 *   shared search popover. Selecting a Pokémon fills the active slot
 *   and keeps the popover open so the user can tap another slot to
 *   continue picking.
 * - Visitor mode: read-only; empty slots are dimmed circles.
 *
 * Performance: the ~25 KB names list is lazy-fetched from `/public`
 * on first open (CDN-cached, zero per-keystroke server cost), and
 * PATCHes to `/api/profile` are debounced 700ms so a 6-pick session
 * costs roughly one API call.
 */
export default function TeamOfSix({
  initial,
  isOwner,
  defaultSuggestions = [],
}: Props) {
  const [team, setTeam] = useState<(string | null)[]>(() => normalize(initial));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Outside-click / Escape closes the popover.
  useEffect(() => {
    if (activeSlot === null) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setActiveSlot(null);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveSlot(null);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [activeSlot]);

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (activeSlot !== null) inputRef.current?.focus();
  }, [activeSlot]);

  async function ensureNames() {
    if (names) return;
    try {
      const res = await fetch("/pokemon-names.json", { cache: "force-cache" });
      if (res.ok) {
        const data = (await res.json()) as string[];
        setNames(data);
      }
    } catch {
      // Network failure — popover will just show an empty result list.
    }
  }

  function scheduleSave(next: (string | null)[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_of_6: next }),
        });
        router.refresh();
      } catch {
        // Optimistic UI already updated; user can re-pick on failure.
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function openSlot(i: number) {
    if (!isOwner) return;
    setActiveSlot(i);
    setQuery("");
    // Defer the names-list fetch until the user actually types — the
    // empty-query view shows `defaultSuggestions`, which the page
    // already had in memory for free.
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length > 0) ensureNames();
  }

  function pickName(name: string) {
    if (activeSlot === null) return;
    const next = [...team];
    next[activeSlot] = name;
    setTeam(next);
    scheduleSave(next);
    // Stay open; advance to the next still-empty slot to streamline
    // multi-pick. If none remain empty, stay on the current slot so
    // the user can swap their choice.
    const nextEmpty = next.findIndex((slot, i) => slot === null && i > activeSlot);
    if (nextEmpty !== -1) setActiveSlot(nextEmpty);
    setQuery("");
    inputRef.current?.focus();
  }

  function clearSlot(i: number) {
    const next = [...team];
    next[i] = null;
    setTeam(next);
    scheduleSave(next);
  }

  const trimmedQuery = query.trim();

  // Empty query → contextual defaults from the page (deck avatars or
  // top-10 meta). Falls back to the still-loading-or-empty full list.
  // Non-empty query → search the full names list once it's loaded;
  // prefix matches surface before substring matches.
  const results = useMemo(() => {
    if (!trimmedQuery) return defaultSuggestions;
    if (!names) return [];
    const q = trimmedQuery.toLowerCase();
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const n of names) {
      const lower = n.toLowerCase();
      if (lower.startsWith(q)) prefix.push(n);
      else if (lower.includes(q)) sub.push(n);
      if (prefix.length + sub.length >= RESULT_LIMIT * 2) break;
    }
    return [...prefix, ...sub].slice(0, RESULT_LIMIT);
  }, [names, trimmedQuery, defaultSuggestions]);

  return (
    <div ref={containerRef} className="relative">
      {/* Slot grid — 3×2 on mobile, single row of 6 (large) on lg+. */}
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-4">
        {team.map((name, i) => (
          <Slot
            key={i}
            name={name}
            isOwner={isOwner}
            isActive={activeSlot === i}
            onOpen={() => openSlot(i)}
            onClear={() => clearSlot(i)}
          />
        ))}
      </div>

      {/* Shared popover. Renders outside the banner's overflow-hidden
          parent (the team row is positioned as an absolute sibling of
          the banner, see UserProfileHeader). */}
      {activeSlot !== null && isOwner && (
        <div
          role="dialog"
          aria-label="Pick a Pokémon"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-3 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-black/8 bg-white/95 backdrop-blur-xl shadow-xl p-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search Pokémon…"
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {trimmedQuery && !names ? (
              <p className="text-xs text-text-muted px-2 py-3">Loading…</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-text-muted px-2 py-3">
                {trimmedQuery ? "No matches." : "No suggestions yet."}
              </p>
            ) : (
              <ul className="grid grid-cols-1">
                {results.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => pickName(n)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg transition-colors"
                    >
                      <SpriteImg name={n} size={28} />
                      <span className="text-sm text-text-primary truncate">
                        {n}
                      </span>
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

/* ─── Slot ──────────────────────────────────────────────────── */

function Slot({
  name,
  isOwner,
  isActive,
  onOpen,
  onClear,
}: {
  name: string | null;
  isOwner: boolean;
  isActive: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  // Shared circle sizing — 36px mobile, 144px (3x) on lg+. Border and
  // shadow stay constant; the inner glyph scales via flex children.
  const circle = "w-9 h-9 lg:w-36 lg:h-36";

  // Visitor + empty slot → dimmed, non-interactive.
  if (!isOwner && !name) {
    return (
      <div
        aria-hidden="true"
        className={`${circle} rounded-full border-2 border-white/70 bg-white/30`}
      />
    );
  }

  const ring = isActive ? "ring-2 ring-offset-2 ring-white ring-offset-transparent" : "";

  // Filled slot. Owners can click to swap; right-click clears.
  if (name) {
    return (
      <button
        type="button"
        onClick={isOwner ? onOpen : undefined}
        onContextMenu={(e) => {
          if (!isOwner) return;
          e.preventDefault();
          onClear();
        }}
        aria-label={isOwner ? `Change slot (${name})` : name}
        title={isOwner ? `${name} — click to change, right-click to clear` : name}
        className={`${circle} rounded-full border-2 border-white bg-white/70 overflow-hidden flex items-center justify-center shadow-md ${ring} ${
          isOwner ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <SpriteImg name={name} className="w-full h-full text-sm lg:text-6xl" />
      </button>
    );
  }

  // Empty owner slot — the plus.
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Add Pokémon to team"
      className={`${circle} rounded-full border-2 border-white bg-white/70 flex items-center justify-center shadow-md hover:bg-white/90 transition-colors ${ring}`}
    >
      <svg
        className="w-4 h-4 lg:w-14 lg:h-14"
        fill="none"
        viewBox="0 0 24 24"
        stroke="black"
        strokeWidth={2.25}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
      </svg>
    </button>
  );
}

/* ─── SpriteImg ─────────────────────────────────────────────── */

/**
 * Limitless sprite with onError fallback to the Pokémon's first
 * letter on a neutral surface. Accepts either an explicit numeric
 * `size` (popover list — fixed dimensions) or a `className` (slot —
 * `w-full h-full` plus responsive `text-*` for the fallback letter).
 */
function SpriteImg({
  name,
  size,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const sizeStyle = size ? { width: size, height: size } : undefined;
  const fallbackStyle = size
    ? { ...sizeStyle, fontSize: size * 0.45 }
    : sizeStyle;
  if (errored) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-surface text-text-secondary font-semibold ${
          className ?? ""
        }`}
        style={fallbackStyle}
        aria-hidden="true"
      >
        {name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={spriteUrl(name)}
      alt=""
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      className={`object-contain ${className ?? ""}`}
      style={sizeStyle}
      onError={() => setErrored(true)}
    />
  );
}
