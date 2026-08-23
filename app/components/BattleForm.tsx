"use client";

import { useState, useRef, useEffect } from "react";
import type { GamePrize } from "@/lib/bo3";
import { META_ARCHETYPE_NAMES } from "@/lib/metaArchetypes";

// Mirrors the logged-battle result pills in app/my-decks/[id]/BattleHistory.tsx
// so the form's selected state previews exactly how the row will eventually
// render. Pattern follows ShareButton in DeckProfileView's footer:
// `rounded-full` + `bg-gradient-brand`, no real `border` — that's the only
// configuration that paints cleanly against the rounded shape. Win and
// loss therefore ship pure bgs; the tie chip's 1 px black outline comes
// from `shadow-[inset_0_0_0_1px_black]`, which doesn't grow the box
// (so all three render at identical pixel dimensions).
// Dark mode: loss and draw are opposite black/white pills in light mode, so
// naively swapping loss's black to white (the usual solid-pill treatment)
// while draw's white stays put would make both render as the same white
// pill once .dark applies. Loss instead steps down to the surface-2 neutral
// (still reads as the "heaviest" pill) while draw moves to surface-elevated
// with its ring brightened so the two stay visually distinct.
const RESULT_STYLE = {
  win: { bg: "bg-gradient-brand", text: "text-white" },
  loss: { bg: "bg-black dark:bg-surface-2", text: "text-white" },
  draw: {
    bg: "bg-white shadow-[inset_0_0_0_1px_black] dark:bg-surface-elevated dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]",
    text: "text-text-primary",
  },
};

// `<input type="date">` can't be fully de-chromed across browsers (Safari in
// particular always renders its own boxed control regardless of
// `appearance`), so the visible "capsule" is a plain div showing this
// formatted string. The native input stays mounted but invisible, purely to
// drive the OS date picker via `showPicker()`.
function formatBattleDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface BattleFormData {
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string | null;
  /** Ordered per-game outcomes for a Best-of-3 round (e.g. "WW", "WLW"). Null for single games. */
  game_results: string | null;
  /** Prizes taken by the player (0–6), or null if not recorded. Single battles only. */
  prizes_taken_player: number | null;
  /** Prizes taken by the opponent (0–6), or null if not recorded. Single battles only. */
  prizes_taken_opponent: number | null;
  /** Per-game prizes for a Best-of-3 round, aligned to game_results. Null for single battles. */
  game_prizes: GamePrize[] | null;
}

/* ─── Best-of-3 helpers ──────────────────────────────────────── */

type GameLetter = "W" | "L" | "D";

/** Derive the round result + sequence string from per-game outcomes.
 *  Draws count toward neither side. */
function deriveRound(games: (GameLetter | null)[]): {
  result: "win" | "loss" | "draw" | null;
  sequence: string;
} {
  const played = games.filter(
    (g): g is GameLetter => g === "W" || g === "L" || g === "D"
  );
  const wins = played.filter((g) => g === "W").length;
  const losses = played.filter((g) => g === "L").length;
  const result =
    played.length >= 2
      ? wins > losses
        ? "win"
        : losses > wins
        ? "loss"
        : "draw"
      : null;
  return { result, sequence: played.join("") };
}

/** Map a single game's W/L/D letter to a battle result (single-game mode). */
function gameToResult(g: GameLetter | null): "win" | "loss" | "draw" | null {
  return g === "W" ? "win" : g === "L" ? "loss" : g === "D" ? "draw" : null;
}

/** Parse a stored "WLW" sequence into the 3-slot game array the form drives. */
function parseGames(seq: string | null | undefined): (GameLetter | null)[] {
  const slots: (GameLetter | null)[] = [null, null, null];
  if (seq) {
    for (let i = 0; i < Math.min(seq.length, 3); i++) {
      const ch = seq[i].toUpperCase();
      if (ch === "W" || ch === "L" || ch === "D") slots[i] = ch;
    }
  }
  return slots;
}

/** Clamp a prize-count input to 0–6, or null when blank/invalid. */
function parsePrize(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(6, n));
}

/** A per-game prize slot as edited in the form (string inputs). */
type PrizeSlot = { p: string; o: string };

/** Seed the 3 per-game prize slots from a stored game_prizes array. */
function parseGamePrizes(gp: GamePrize[] | null | undefined): PrizeSlot[] {
  const slots: PrizeSlot[] = [
    { p: "", o: "" },
    { p: "", o: "" },
    { p: "", o: "" },
  ];
  if (Array.isArray(gp)) {
    gp.slice(0, 3).forEach((g, i) => {
      slots[i] = {
        p: g?.p != null ? String(g.p) : "",
        o: g?.o != null ? String(g.o) : "",
      };
    });
  }
  return slots;
}

interface Props {
  /** Called with form data when the user submits. Caller handles the API call. */
  onSubmit: (data: BattleFormData) => Promise<void>;
  onCancel: () => void;
  /** Pre-populated values for edit mode. If omitted, form starts empty (new battle). */
  initial?: Partial<BattleFormData>;
  /** Button label. Defaults to "Save Battle". */
  submitLabel?: string;
  /** If true, show a compact form (no opponent deck list toggle). */
  compact?: boolean;
  /**
   * Controlled Best-of-3 mode. When provided, the parent owns the toggle
   * (e.g. the capsule in BattleEntry's tab row) and the form hides its own
   * inline toggle. Omit for the standalone edit / quick-log forms, which keep
   * their internal toggle.
   */
  bestOf3?: boolean;
  onBestOf3Change?: (value: boolean) => void;
  /** Whether Cancel scrolls the page to top before closing. Defaults to
   *  true (deck-profile behavior); grid preview cards pass false since
   *  the form sits inline in the page flow. */
  scrollToTopOnCancel?: boolean;
  /**
   * Whether this form is currently visible/open. Gates the new-battle
   * opponent-name autofocus. Defaults to true for callers that only mount
   * the form when it's open. The deck-collection grid card and pinned
   * hero keep the form permanently mounted inside a collapsed
   * grid-rows-[0fr] drawer, so they pass `active={logOpen}` — otherwise
   * every card's hidden form would grab focus on page load and the
   * browser would scroll the last one (bottom of the page) into view.
   */
  active?: boolean;
}

/**
 * Shared battle logging / editing form. Used by:
 *   - BattleHistory (new battle + edit battle on deck detail page)
 *   - SavedDeckRow (quick-log from My Decks list)
 */
export default function BattleForm({
  onSubmit,
  onCancel,
  initial,
  submitLabel = "Save Battle",
  compact = false,
  bestOf3: bestOf3Prop,
  onBestOf3Change,
  scrollToTopOnCancel = true,
  active = true,
}: Props) {
  const [opponentName, setOpponentName] = useState(initial?.opponent_name ?? "");
  const [opponentArchetype, setOpponentArchetype] = useState(
    initial?.opponent_archetype ?? ""
  );
  const [opponentDeckList, setOpponentDeckList] = useState(
    initial?.opponent_deck_list ?? ""
  );
  const [showDeckListField, setShowDeckListField] = useState(
    !!initial?.opponent_deck_list
  );
  const [battleNotes, setBattleNotes] = useState(initial?.notes ?? "");
  const [showNotesField, setShowNotesField] = useState(!!initial?.notes);
  // New battles default the date to today; edits respect the stored value.
  const [showDateField, setShowDateField] = useState(
    initial ? initial.played_at != null : true
  );
  const [battleDate, setBattleDate] = useState(() => {
    if (initial?.played_at) {
      return new Date(initial.played_at).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  });
  // Best-of-3 game tracking — starts on when editing a battle that has games.
  // Controlled by the parent when bestOf3Prop is set (BattleEntry's capsule
  // toggle); otherwise self-managed for the standalone edit / quick-log forms.
  const [internalBestOf3, setInternalBestOf3] = useState(!!initial?.game_results);
  const bestOf3Controlled = bestOf3Prop !== undefined;
  const bestOf3 = bestOf3Prop ?? internalBestOf3;
  const setBestOf3 = (value: boolean) => {
    if (onBestOf3Change) onBestOf3Change(value);
    else setInternalBestOf3(value);
  };
  // Game 1 doubles as the single-game result when bestOf3 is off, so it's
  // seeded from `result` / battle-level prizes when no per-game data exists.
  const [games, setGames] = useState<(GameLetter | null)[]>(() => {
    const slots = parseGames(initial?.game_results);
    if (!initial?.game_results && initial?.result) {
      slots[0] =
        initial.result === "win" ? "W" : initial.result === "loss" ? "L" : "D";
    }
    return slots;
  });
  // Per-game prizes — game 1's slot also serves as the single-game prizes.
  const [gamePrizes, setGamePrizes] = useState<PrizeSlot[]>(() => {
    const slots = parseGamePrizes(initial?.game_prizes);
    if (!initial?.game_prizes) {
      slots[0] = {
        p: initial?.prizes_taken_player != null ? String(initial.prizes_taken_player) : "",
        o: initial?.prizes_taken_opponent != null ? String(initial.prizes_taken_opponent) : "",
      };
    }
    return slots;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop game 2/3 + their prizes when the round flips back to a single
  // battle, so stale data can't linger (covers both toggles). Game 1 is kept.
  useEffect(() => {
    if (!bestOf3) {
      setGames((prev) => [prev[0], null, null]);
      setGamePrizes((prev) => [prev[0], { p: "", o: "" }, { p: "", o: "" }]);
    }
  }, [bestOf3]);

  // Archetype autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const dateInputRef = useRef<HTMLInputElement>(null);
  const opponentNameRef = useRef<HTMLInputElement>(null);

  // Focus the opponent name field when logging a new battle (not when
  // editing an existing one). The input carries [font-size:16px] so iOS
  // Safari doesn't zoom the viewport on focus.
  //
  // Gated on `active`: the grid card + pinned-hero drawers keep this form
  // permanently mounted but collapsed (grid-rows-[0fr]), so without the
  // gate every hidden form would call focus() on page load and the
  // browser would scroll the last one — bottom of the page — into view.
  // With active={logOpen} the focus fires only when the drawer opens
  // (active flips false→true, re-running this effect).
  useEffect(() => {
    if (initial || !active) return;
    const id = requestAnimationFrame(() => opponentNameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [initial, active]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleArchetypeChange(val: string) {
    setOpponentArchetype(val);
    if (val.trim().length > 0) {
      const lower = val.toLowerCase();
      setSuggestions(
        META_ARCHETYPE_NAMES.filter((a) => a.toLowerCase().includes(lower)).slice(
          0,
          6
        )
      );
      setShowSuggestions(true);
    } else {
      setSuggestions(META_ARCHETYPE_NAMES.slice(0, 8));
      setShowSuggestions(false);
    }
  }

  function setGame(i: number, letter: GameLetter) {
    const next: (GameLetter | null)[] = [...games];
    next[i] = games[i] === letter ? null : letter; // tap again to clear
    // Game 3 is in play only once the first two are both set and neither
    // side already has 2 wins (draws don't decide). Otherwise drop it.
    const firstTwoSet = next[0] != null && next[1] != null;
    const w = [next[0], next[1]].filter((g) => g === "W").length;
    const l = [next[0], next[1]].filter((g) => g === "L").length;
    const game3InPlay = firstTwoSet && w < 2 && l < 2;
    if (!game3InPlay) next[2] = null;
    setGames(next);
    if (!game3InPlay && (gamePrizes[2].p !== "" || gamePrizes[2].o !== "")) {
      setGamePrizes((prev) => {
        const np = [...prev];
        np[2] = { p: "", o: "" };
        return np;
      });
    }
  }

  function setGamePrize(i: number, side: "p" | "o", value: string) {
    setGamePrizes((prev) => {
      const np = [...prev];
      np[i] = { ...np[i], [side]: value };
      return np;
    });
  }

  async function handleSubmit() {
    const { result: derivedResult, sequence } = deriveRound(games);
    const finalResult = bestOf3 ? derivedResult : gameToResult(games[0]);
    if (!finalResult) {
      setError(bestOf3 ? "Enter at least 2 games." : "Select a result.");
      return;
    }
    // Per-game prizes align with the played games (same order as the sequence).
    const playedIdx = games
      .map((g, i) => (g === "W" || g === "L" ? i : -1))
      .filter((i) => i >= 0);
    const gamePrizesOut: GamePrize[] = playedIdx.map((i) => ({
      p: parsePrize(gamePrizes[i].p),
      o: parsePrize(gamePrizes[i].o),
    }));
    const anyGamePrize = gamePrizesOut.some((g) => g.p !== null || g.o !== null);

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        result: finalResult,
        opponent_name: opponentName.trim() || null,
        opponent_archetype: opponentArchetype.trim() || null,
        opponent_deck_list:
          showDeckListField ? opponentDeckList.trim() || null : null,
        notes: showNotesField ? battleNotes.trim() || null : null,
        played_at: showDateField
          ? new Date(battleDate + "T12:00:00").toISOString()
          : null,
        game_results: bestOf3 ? sequence : null,
        // Single battle → battle-level prizes; Best of 3 → per-game prizes.
        prizes_taken_player: bestOf3 ? null : parsePrize(gamePrizes[0].p),
        prizes_taken_opponent: bestOf3 ? null : parsePrize(gamePrizes[0].o),
        game_prizes: bestOf3 && anyGamePrize ? gamePrizesOut : null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const { result: derivedResult } = deriveRound(games);
  const canSubmit = bestOf3 ? !!derivedResult : !!gameToResult(games[0]);

  // Game 3 is in play only once games 1 and 2 are both set and neither side
  // already has 2 wins (draws don't decide).
  const firstTwoSet = games[0] != null && games[1] != null;
  const w01 = [games[0], games[1]].filter((g) => g === "W").length;
  const l01 = [games[0], games[1]].filter((g) => g === "L").length;
  const g3Disabled = !firstTwoSet || w01 >= 2 || l01 >= 2;

  function renderGameRow(i: number, disabled: boolean) {
    return (
      <div className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
        {(["W", "L", "D"] as const).map((letter) => {
          const selected = games[i] === letter;
          const s =
            letter === "W"
              ? RESULT_STYLE.win
              : letter === "L"
              ? RESULT_STYLE.loss
              : RESULT_STYLE.draw;
          const label = letter === "W" ? "Win" : letter === "L" ? "Loss" : "Draw";
          return (
            <button
              key={letter}
              type="button"
              disabled={disabled}
              onClick={() => setGame(i, letter)}
              aria-label={`Battle ${i + 1} ${label.toLowerCase()}`}
              style={{ flexGrow: games[i] == null || selected ? 2 : 1 }}
              className={`flex-1 rounded-full py-2.5 text-sm font-bold transition-all duration-300 disabled:cursor-not-allowed ${
                selected
                  ? `${s.bg} ${s.text}`
                  : "bg-bg text-text-secondary shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
              }`}
            >
              {games[i] == null || selected ? label : letter}
            </button>
          );
        })}
        {/* Per-battle prizes */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={6}
            disabled={disabled}
            value={gamePrizes[i].p}
            onChange={(e) => setGamePrize(i, "p", e.target.value)}
            placeholder="You"
            aria-label={`Battle ${i + 1} your prizes`}
            className="no-spinner w-12 rounded-full bg-bg py-2.5 text-center text-sm font-bold text-text-primary placeholder:font-normal placeholder:text-xs placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50 [font-size:16px] sm:text-sm"
          />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={6}
            disabled={disabled}
            value={gamePrizes[i].o}
            onChange={(e) => setGamePrize(i, "o", e.target.value)}
            placeholder="Opp"
            aria-label={`Battle ${i + 1} opponent prizes`}
            className="no-spinner w-12 rounded-full bg-bg py-2.5 text-center text-sm font-bold text-text-primary placeholder:font-normal placeholder:text-xs placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50 [font-size:16px] sm:text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-1">
      {/* Opponent name */}
      <input
        ref={opponentNameRef}
        type="text"
        value={opponentName}
        onChange={(e) => setOpponentName(e.target.value)}
        placeholder="Opponent name"
        className="w-full mb-2 rounded-full bg-bg px-4 py-2 text-sm text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
      />

      {/* Opponent archetype + "+ Deck List" pill inline */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1" ref={suggestionsRef}>
          <input
            type="text"
            value={opponentArchetype}
            onChange={(e) => handleArchetypeChange(e.target.value)}
            onFocus={() => {
              if (opponentArchetype.trim() === "") {
                setSuggestions(META_ARCHETYPE_NAMES.slice(0, 8));
              }
              setShowSuggestions(true);
            }}
            placeholder="Opponent deck / archetype"
            className="w-full rounded-full bg-bg px-4 py-2 text-sm text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border bg-surface shadow-lg max-h-48 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpponentArchetype(s);
                    setShowSuggestions(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {!compact && (
          <button
            type="button"
            onClick={() => setShowDeckListField((v) => !v)}
            className={`h-9 flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
              showDeckListField
                ? "bg-black/70 text-white dark:bg-white/70 dark:text-black"
                : "bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showDeckListField ? "rotate-45" : ""
              }`}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Deck List
          </button>
        )}
      </div>

      {/* Opponent deck list — slides in below archetype row */}
      {!compact && (
        <div
          className={`grid transition-all duration-300 ${
            showDeckListField ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="pt-1 pb-4">
              <textarea
                value={opponentDeckList}
                onChange={(e) => setOpponentDeckList(e.target.value)}
                placeholder="Paste opponent's deck list"
                rows={4}
                className="w-full rounded-lg bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y [font-size:16px] sm:text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Result — game 1 doubles as the single-game row; games 2 & 3 slide
          in/out when Best of 3 is toggled. */}
      <div className="mb-3">
        {!bestOf3Controlled && bestOf3 && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text-secondary">
              Best of 3
            </span>
            <button
              type="button"
              onClick={() => setBestOf3(false)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Single game
            </button>
          </div>
        )}

        {/* Prizes title, centered over the You/Opp capsules below */}
        <div className="mb-1 flex items-center">
          <span className="ml-auto w-[6.25rem] text-center text-[10px] font-bold uppercase tracking-wide text-text-primary">
            Prizes
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {renderGameRow(0, false)}
          <div
            className={`grid transition-all duration-300 ${
              bestOf3 ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden min-h-0">
              <div className="flex flex-col gap-1.5 pt-1.5">
                {renderGameRow(1, false)}
                {renderGameRow(2, g3Disabled)}
              </div>
            </div>
          </div>
        </div>

        {!bestOf3Controlled && !bestOf3 && (
          <button
            type="button"
            onClick={() => setBestOf3(true)}
            className="mt-1.5 text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Track as Best of 3
          </button>
        )}
      </div>

      {/* Utility row: [+ Notes pill] [spacer] [date display + X] or [+ date] */}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNotesField((v) => !v)}
          className={`h-10 inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
            showNotesField
              ? "bg-black/70 text-white dark:bg-white/70 dark:text-black"
              : "bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              showNotesField ? "rotate-45" : ""
            }`}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Notes
        </button>
        <div className="flex-1" />
        {showDateField ? (
          <>
            <div className="relative">
              <div className="pointer-events-none flex items-center gap-2 rounded-full bg-bg px-4 py-2.5 text-sm font-bold text-text-primary shadow-[inset_0_0_0_1px_var(--border)]">
                <span>{formatBattleDate(battleDate)}</span>
                <svg className="w-4 h-4 flex-shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 18.75h16.5a1.5 1.5 0 001.5-1.5V6.75a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v10.5a1.5 1.5 0 001.5 1.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18" />
                </svg>
              </div>
              <input
                ref={dateInputRef}
                type="date"
                value={battleDate}
                onChange={(e) => setBattleDate(e.target.value)}
                onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
                aria-label="Battle date"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [font-size:16px]"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowDateField(false)}
              aria-label="Remove battle date"
              className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-bg text-text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-text-secondary hover:bg-surface-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowDateField(true)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Add date
          </button>
        )}
      </div>

      {/* Notes input — slides in below utility row */}
      <div
        className={`grid transition-all duration-300 ${
          showNotesField ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="pt-1 pb-4">
            <input
              type="text"
              value={battleNotes}
              onChange={(e) => setBattleNotes(e.target.value)}
              placeholder="Notes"
              className="w-full rounded-full bg-bg px-4 py-2 text-sm text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-accent mb-2">{error}</p>}

      <div data-battle-actions className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
        <button
          onClick={() => {
            if (scrollToTopOnCancel) window.scrollTo({ top: 0, behavior: "smooth" });
            onCancel();
          }}
          className="rounded-full border border-border bg-bg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-2 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
