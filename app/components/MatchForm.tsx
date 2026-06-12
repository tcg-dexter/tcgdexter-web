"use client";

import { useState, useRef, useEffect } from "react";

/* ─── Meta archetype names for autocomplete ─────────────────── */
const META_ARCHETYPES = [
  "Alakazam Dudunsparce", "Ceruledge", "Clefairy Ogerpon", "Crustle",
  "Cynthia's Garchomp", "Dragapult", "Dragapult Blaziken", "Dragapult Dusknoir",
  "Festival Lead", "Flareon Noctowl", "Froslass Munkidori", "Greninja",
  "Grimmsnarl Froslass", "Hop's Trevenant", "Lucario Hariyama", "Mega Absol Box",
  "Mega Kangaskhan", "Mega Lucario", "Mega Starmie", "Mega Venusaur",
  "N's Zoroark", "Ogerpon Meganium", "Okidogi", "Raging Bolt Ogerpon",
  "Rocket's Honchkrow", "Rocket's Mewtwo", "Slowking", "Starmie Froslass",
  "Steven's Metagross", "Tera Box",
];

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
  prizes_taken_player: number | null;
  prizes_taken_opponent: number | null;
}

/** Clamp a prize-count input to the 0–6 range a TCG match can produce. */
function clampPrizes(val: string): number {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(6, Math.max(0, n));
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
  const [showDateField, setShowDateField] = useState(!!initial?.played_at);
  const [matchDate, setMatchDate] = useState(() => {
    if (initial?.played_at) {
      return new Date(initial.played_at).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  });
  const [showPrizesField, setShowPrizesField] = useState(
    initial?.prizes_taken_player != null && initial?.prizes_taken_opponent != null
  );
  const [prizesPlayer, setPrizesPlayer] = useState(
    initial?.prizes_taken_player != null ? String(initial.prizes_taken_player) : "0"
  );
  const [prizesOpponent, setPrizesOpponent] = useState(
    initial?.prizes_taken_opponent != null ? String(initial.prizes_taken_opponent) : "0"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        META_ARCHETYPES.filter((a) => a.toLowerCase().includes(lower)).slice(
          0,
          6
        )
      );
      setShowSuggestions(true);
    } else {
      setSuggestions(META_ARCHETYPES.slice(0, 8));
      setShowSuggestions(false);
    }
  }

  async function handleSubmit() {
    if (!result) {
      setError("Select a result.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        result,
        opponent_name: opponentName.trim() || null,
        opponent_archetype: opponentArchetype.trim() || null,
        opponent_deck_list:
          showDeckListField ? opponentDeckList.trim() || null : null,
        notes: matchNotes.trim() || null,
        played_at: showDateField
          ? new Date(matchDate + "T12:00:00").toISOString()
          : null,
        prizes_taken_player: showPrizesField ? clampPrizes(prizesPlayer) : null,
        prizes_taken_opponent: showPrizesField ? clampPrizes(prizesOpponent) : null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-2">
      {/* Result buttons */}
      <div className="flex gap-2 mb-3">
        {(["win", "loss", "draw"] as const).map((r) => {
          const s = RESULT_STYLE[r];
          const selected = result === r;
          return (
            <button
              key={r}
              onClick={() => setResult(r)}
              // Unselected uses an inset shadow for its 1 px outline so it
              // stays dimensionally identical to the selected variants
              // (which carry no real `border`). A real `border-border` here
              // would push the button out by 2 px and shift the row's
              // baseline whenever the selection changes.
              className={`flex-1 rounded-full py-2.5 text-sm font-bold transition-all ${
                selected
                  ? `${s.bg} ${s.text}`
                  : "bg-bg text-text-secondary shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
              }`}
            >
              {r === "win" ? "Win" : r === "loss" ? "Loss" : "Draw"}
            </button>
          );
        })}
      </div>

      {/* Opponent name */}
      <input
        type="text"
        value={opponentName}
        onChange={(e) => setOpponentName(e.target.value)}
        placeholder="Opponent name (optional)"
        className="w-full mb-2 rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
      />

      {/* Opponent archetype with autocomplete */}
      <div className="relative mb-2" ref={suggestionsRef}>
        <input
          type="text"
          value={opponentArchetype}
          onChange={(e) => handleArchetypeChange(e.target.value)}
          onFocus={() => {
            if (opponentArchetype.trim() === "") {
              setSuggestions(META_ARCHETYPES.slice(0, 8));
            }
            setShowSuggestions(true);
          }}
          placeholder="Opponent deck / archetype (optional)"
          className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
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

      {/* Match notes */}
      <input
        type="text"
        value={matchNotes}
        onChange={(e) => setMatchNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full mb-2 rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
      />

      {/* Optional toggles — left-aligned */}
      <div className="flex flex-col items-start gap-1 mb-3">
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
                  placeholder="Paste opponent's deck list (optional)"
                  rows={4}
                  className="w-full mb-1 rounded-lg bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y [font-size:16px] sm:text-xs"
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

        {!showDateField ? (
          <button
            type="button"
            onClick={() => setShowDateField(true)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Add match date
          </button>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <input
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
              className="flex-1 rounded-lg bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
            />
            <button
              type="button"
              onClick={() => setShowDateField(false)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              Remove
            </button>
          </div>
        )}

        {!showPrizesField ? (
          <button
            type="button"
            onClick={() => setShowPrizesField(true)}
            className="text-xs text-accent hover:text-accent-light transition-colors"
          >
            + Add prize count
          </button>
        ) : (
          <div className="flex items-end gap-2 w-full">
            <label className="flex-1">
              <span className="block mb-1 text-xs text-text-muted">Prizes you took</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={6}
                value={prizesPlayer}
                onChange={(e) => setPrizesPlayer(e.target.value)}
                className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
              />
            </label>
            <label className="flex-1">
              <span className="block mb-1 text-xs text-text-muted">Prizes opponent took</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={6}
                value={prizesOpponent}
                onChange={(e) => setPrizesOpponent(e.target.value)}
                className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowPrizesField(false)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors pb-2"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-accent mb-2">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !result}
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
