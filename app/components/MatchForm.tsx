"use client";

import { useState, useRef, useEffect } from "react";
import type { GamePrize } from "@/lib/bo3";
import { META_ARCHETYPE_NAMES } from "@/lib/metaArchetypes";

// Mirrors the logged-match result pills in app/my-decks/[id]/MatchLog.tsx
// so the form's selected state previews exactly how the row will eventually
// render. Pattern follows ShareButton in DeckProfileView's footer:
// `rounded-full` + `bg-gradient-brand`, no real `border` — that's the only
// configuration that paints cleanly against the rounded shape. Win and
// loss therefore ship pure bgs; the tie chip's 1 px black outline comes
// from `shadow-[inset_0_0_0_1px_black]`, which doesn't grow the box
// (so all three render at identical pixel dimensions).
const RESULT_STYLE = {
  win:  { bg: "bg-gradient-brand",                       text: "text-white"        },
  loss: { bg: "bg-black",                                text: "text-white"        },
  draw: { bg: "bg-white shadow-[inset_0_0_0_1px_black]", text: "text-text-primary" },
};

export interface MatchFormData {
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string | null;
  /** Ordered per-game outcomes for a Best-of-3 round (e.g. "WW", "WLW"). Null for single games. */
  game_results: string | null;
  /** Prizes taken by the player (0–6), or null if not recorded. Single matches only. */
  prizes_taken_player: number | null;
  /** Prizes taken by the opponent (0–6), or null if not recorded. Single matches only. */
  prizes_taken_opponent: number | null;
  /** Per-game prizes for a Best-of-3 round, aligned to game_results. Null for single matches. */
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
  onSubmit: (data: MatchFormData) => Promise<void>;
  onCancel: () => void;
  /** Pre-populated values for edit mode. If omitted, form starts empty (new match). */
  initial?: Partial<MatchFormData>;
  /** Button label. Defaults to "Save Match". */
  submitLabel?: string;
  /** If true, show a compact form (no opponent deck list toggle). */
  compact?: boolean;
  /**
   * Controlled Best-of-3 mode. When provided, the parent owns the toggle
   * (e.g. the capsule in MatchEntry's tab row) and the form hides its own
   * inline toggle. Omit for the standalone edit / quick-log forms, which keep
   * their internal toggle.
   */
  bestOf3?: boolean;
  onBestOf3Change?: (value: boolean) => void;
}

/**
 * Shared match logging / editing form. Used by:
 *   - MatchLog (new match + edit match on deck detail page)
 *   - SavedDeckRow (quick-log from My Decks list)
 */
export default function MatchForm({
  onSubmit,
  onCancel,
  initial,
  submitLabel = "Save Match",
  compact = false,
  bestOf3: bestOf3Prop,
  onBestOf3Change,
}: Props) {
  const [result, setResult] = useState<"win" | "loss" | "draw" | null>(
    initial?.result ?? null
  );
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
  const [matchNotes, setMatchNotes] = useState(initial?.notes ?? "");
  const [showNotesField, setShowNotesField] = useState(!!initial?.notes);
  // New matches default the date to today; edits respect the stored value.
  const [showDateField, setShowDateField] = useState(
    initial ? initial.played_at != null : true
  );
  const [matchDate, setMatchDate] = useState(() => {
    if (initial?.played_at) {
      return new Date(initial.played_at).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  });
  // Best-of-3 game tracking — starts on when editing a match that has games.
  // Controlled by the parent when bestOf3Prop is set (MatchEntry's capsule
  // toggle); otherwise self-managed for the standalone edit / quick-log forms.
  const [internalBestOf3, setInternalBestOf3] = useState(!!initial?.game_results);
  const bestOf3Controlled = bestOf3Prop !== undefined;
  const bestOf3 = bestOf3Prop ?? internalBestOf3;
  const setBestOf3 = (value: boolean) => {
    if (onBestOf3Change) onBestOf3Change(value);
    else setInternalBestOf3(value);
  };
  const [games, setGames] = useState<(GameLetter | null)[]>(
    parseGames(initial?.game_results)
  );
  const [playerPrizes, setPlayerPrizes] = useState(
    initial?.prizes_taken_player != null ? String(initial.prizes_taken_player) : ""
  );
  const [opponentPrizes, setOpponentPrizes] = useState(
    initial?.prizes_taken_opponent != null ? String(initial.prizes_taken_opponent) : ""
  );
  // Per-game prizes for Best of 3 (one {p,o} slot per game).
  const [gamePrizes, setGamePrizes] = useState<PrizeSlot[]>(
    parseGamePrizes(initial?.game_prizes)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop any entered games + per-game prizes when the round flips back to a
  // single match, so stale data can't linger (covers both toggles).
  useEffect(() => {
    if (!bestOf3) {
      setGames([null, null, null]);
      setGamePrizes([
        { p: "", o: "" },
        { p: "", o: "" },
        { p: "", o: "" },
      ]);
    }
  }, [bestOf3]);

  // Archetype autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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
    // Match 3 is in play only once the first two are both set and neither
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
    const finalResult = bestOf3 ? derivedResult : result;
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
        notes: showNotesField ? matchNotes.trim() || null : null,
        played_at: showDateField
          ? new Date(matchDate + "T12:00:00").toISOString()
          : null,
        game_results: bestOf3 ? sequence : null,
        // Single match → match-level prizes; Best of 3 → per-game prizes.
        prizes_taken_player: bestOf3 ? null : parsePrize(playerPrizes),
        prizes_taken_opponent: bestOf3 ? null : parsePrize(opponentPrizes),
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

  const { result: derivedResult, sequence } = deriveRound(games);
  const canSubmit = bestOf3 ? !!derivedResult : !!result;

  return (
    <div className="pt-1">
      {/* Match date — shown at the top of the form when set (defaults to today) */}
      {showDateField && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <input
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            className="rounded-full bg-bg pl-0 pr-4 py-1.5 text-sm text-text-primary shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
          />
          <button
            type="button"
            onClick={() => setShowDateField(false)}
            aria-label="Remove match date"
            className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg text-text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-text-secondary hover:bg-surface-2 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Opponent name */}
      <input
        type="text"
        value={opponentName}
        onChange={(e) => setOpponentName(e.target.value)}
        placeholder="Opponent name"
        className="w-full mb-2 rounded-full bg-bg px-4 py-2 text-sm text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
      />

      {/* Opponent archetype with autocomplete */}
      <div className="relative mb-1" ref={suggestionsRef}>
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

      {/* Optional toggles — left-aligned */}
      <div className="flex flex-col items-start gap-1 mb-3">
        {/* Notes — optional, like the deck list */}
        {!showNotesField ? (
          <button
            type="button"
            onClick={() => setShowNotesField(true)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Add notes
          </button>
        ) : (
          <div className="w-full">
            <input
              type="text"
              value={matchNotes}
              onChange={(e) => setMatchNotes(e.target.value)}
              placeholder="Notes"
              className="w-full mb-1 rounded-full bg-bg px-4 py-2 text-sm text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
            />
            <button
              type="button"
              onClick={() => {
                setShowNotesField(false);
                setMatchNotes("");
              }}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Remove notes
            </button>
          </div>
        )}

        {!compact && (
          <>
            {!showDeckListField ? (
              <button
                type="button"
                onClick={() => setShowDeckListField(true)}
                className="text-xs text-accent hover:text-accent-light transition-colors"
              >
                + Add opponent deck list
              </button>
            ) : (
              <div className="w-full">
                <textarea
                  value={opponentDeckList}
                  onChange={(e) => setOpponentDeckList(e.target.value)}
                  placeholder="Paste opponent's deck list"
                  rows={4}
                  className="w-full mb-1 rounded-lg bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y [font-size:16px] sm:text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowDeckListField(false);
                    setOpponentDeckList("");
                  }}
                  className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  Remove deck list
                </button>
              </div>
            )}
          </>
        )}

        {/* The date field itself renders at the top of the form (see above);
            here we only offer to re-add it once removed. */}
        {!showDateField && (
          <button
            type="button"
            onClick={() => setShowDateField(true)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Add match date
          </button>
        )}
      </div>

      {/* Result — single game (Win/Loss/Draw) or Best-of-3 game tracker */}
      {!bestOf3 ? (
        <div className="mb-3">
          {/* Prizes title, centered over the You/Opp capsules below */}
          <div className="mb-1 flex items-center">
            <span className="ml-auto w-[6.25rem] text-center text-[10px] font-bold uppercase tracking-wide text-text-primary">
              Prizes
            </span>
          </div>

          {/* Win/Loss/Draw fill the width; prize capsules sit on the right */}
          <div className="flex items-center gap-2">
            {(["win", "loss", "draw"] as const).map((r) => {
              const s = RESULT_STYLE[r];
              const selected = result === r;
              const letter = r === "win" ? "W" : r === "loss" ? "L" : "D";
              const label = r === "win" ? "Win" : r === "loss" ? "Loss" : "Draw";
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  style={{ flexGrow: result === null || selected ? 2 : 1 }}
                  // Unselected uses an inset shadow for its 1 px outline so it
                  // stays dimensionally identical to the selected variants
                  // (which carry no real `border`). A real `border-border` here
                  // would push the button out by 2 px and shift the row's
                  // baseline whenever the selection changes.
                  className={`flex-1 rounded-full py-2.5 text-sm font-bold transition-all duration-300 ${
                    selected
                      ? `${s.bg} ${s.text}`
                      : "bg-bg text-text-secondary shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
                  }`}
                >
                  {result === null || selected ? label : letter}
                </button>
              );
            })}
            <div className="flex flex-shrink-0 items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={6}
                value={playerPrizes}
                onChange={(e) => setPlayerPrizes(e.target.value)}
                placeholder="You"
                aria-label="Your prizes taken"
                className="no-spinner w-12 rounded-full bg-bg py-2.5 text-center text-sm font-bold text-text-primary placeholder:font-normal placeholder:text-xs placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
              />
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={6}
                value={opponentPrizes}
                onChange={(e) => setOpponentPrizes(e.target.value)}
                placeholder="Opp"
                aria-label="Opponent prizes taken"
                className="no-spinner w-12 rounded-full bg-bg py-2.5 text-center text-sm font-bold text-text-primary placeholder:font-normal placeholder:text-xs placeholder:text-text-muted shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
              />
            </div>
          </div>

          {!bestOf3Controlled && (
            <button
              type="button"
              onClick={() => setBestOf3(true)}
              className="mt-1.5 text-xs text-accent hover:text-accent-light transition-colors"
            >
              + Track as Best of 3
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3">
          {!bestOf3Controlled && (
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

          {/* Prizes title (top-right) + You / Opp column headers over the inputs */}
          <div className="mb-1 flex items-center">
            <div className="ml-auto flex flex-col gap-0.5">
              <span className="text-center text-[10px] font-bold uppercase tracking-wide text-text-primary">
                Prizes
              </span>
              <div className="flex gap-1">
                <span className="w-10 text-center text-[10px] text-text-muted">You</span>
                <span className="w-10 text-center text-[10px] text-text-muted">Opp</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => {
              // Match 3 is in play only when the first two are both set and
              // neither side already has 2 wins (draws don't decide).
              const firstTwoSet = games[0] != null && games[1] != null;
              const w01 = [games[0], games[1]].filter((g) => g === "W").length;
              const l01 = [games[0], games[1]].filter((g) => g === "L").length;
              const g3Disabled = i === 2 && (!firstTwoSet || w01 >= 2 || l01 >= 2);
              return (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 ${
                    g3Disabled ? "opacity-40" : ""
                  }`}
                >
                  <span className="w-12 flex-shrink-0 whitespace-nowrap text-xs text-text-muted">
                    Match {i + 1}
                  </span>
                  {(["W", "L", "D"] as const).map((letter) => {
                    const selected = games[i] === letter;
                    const s =
                      letter === "W"
                        ? RESULT_STYLE.win
                        : letter === "L"
                        ? RESULT_STYLE.loss
                        : RESULT_STYLE.draw;
                    const label =
                      letter === "W" ? "Win" : letter === "L" ? "Loss" : "Draw";
                    return (
                      <button
                        key={letter}
                        type="button"
                        disabled={g3Disabled}
                        onClick={() => setGame(i, letter)}
                        aria-label={`Match ${i + 1} ${label.toLowerCase()}`}
                        style={{ flexGrow: games[i] == null || selected ? 2 : 1 }}
                        className={`flex-1 rounded-full py-1.5 text-xs font-bold transition-all duration-300 disabled:cursor-not-allowed ${
                          selected
                            ? `${s.bg} ${s.text}`
                            : "bg-bg text-text-secondary shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
                        }`}
                      >
                        {games[i] == null || selected ? label : letter}
                      </button>
                    );
                  })}
                  {/* Per-match prizes — aligned under the You / Opp headers */}
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={6}
                      disabled={g3Disabled}
                      value={gamePrizes[i].p}
                      onChange={(e) => setGamePrize(i, "p", e.target.value)}
                      aria-label={`Match ${i + 1} your prizes`}
                      className="no-spinner w-10 rounded-full bg-surface py-1.5 text-center text-xs font-bold text-text-primary shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50 [font-size:16px] sm:text-xs"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={6}
                      disabled={g3Disabled}
                      value={gamePrizes[i].o}
                      onChange={(e) => setGamePrize(i, "o", e.target.value)}
                      aria-label={`Match ${i + 1} opponent prizes`}
                      className="no-spinner w-10 rounded-full bg-surface py-1.5 text-center text-xs font-bold text-text-primary shadow-[inset_0_0_0_1px_var(--border)] focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50 [font-size:16px] sm:text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

      {error && <p className="text-xs text-accent mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-border bg-bg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-2 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
