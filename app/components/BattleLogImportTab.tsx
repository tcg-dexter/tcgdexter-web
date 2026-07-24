"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBattleLog,
  normalizePerspective,
  summarize,
  type BattleLogSummary,
} from "@/lib/battle-log";
import { clientTz, celebrateStreak } from "@/lib/streak-client";

/* ─── Meta archetypes (mirrored from MatchForm) ────────────────── */

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

// Same chip palette as MatchForm. Keep these in lockstep.
const RESULT_STYLE = {
  win:  { bg: "bg-gradient-brand",                                            text: "text-white"        },
  loss: { bg: "bg-black dark:bg-white",                                       text: "text-white dark:text-black" },
  draw: { bg: "bg-white dark:bg-surface-2 shadow-[inset_0_0_0_1px_black]",    text: "text-text-primary" },
} as const;

/* ─── Component ───────────────────────────────────────────────── */

interface Props {
  savedDeckId: string;
  onSuccess: () => void;
  onCancel: () => void;
  /** Whether Cancel scrolls the page to top before closing. Defaults to
   *  true (deck-profile behavior); grid preview cards pass false since
   *  the form sits inline in the page flow. */
  scrollToTopOnCancel?: boolean;
}

type Phase = "paste" | "review";

export default function BattleLogImportTab({
  savedDeckId,
  onSuccess,
  onCancel,
  scrollToTopOnCancel = true,
}: Props) {
  const [phase, setPhase] = useState<Phase>("paste");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Review-phase state
  const [handles, setHandles] = useState<string[]>([]);
  const [playerHandle, setPlayerHandle] = useState<string | null>(null);
  const [summary, setSummary] = useState<BattleLogSummary | null>(null);
  const [result, setResult] = useState<"win" | "loss" | "draw" | null>(null);
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  // Saved-handle integration
  const [savedHandle, setSavedHandle] = useState<string | null | undefined>(undefined);
  const [savePromptVisible, setSavePromptVisible] = useState(false);
  const [savePromptChecked, setSavePromptChecked] = useState(true);

  // Optional fields
  const [opponentArchetype, setOpponentArchetype] = useState("");
  const [notes, setNotes] = useState("");
  const [showDateField, setShowDateField] = useState(false);
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Autocomplete state
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

  // Lazily fetch the user's saved TCG Live handle on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/tcg-live-handle")
      .then((r) => (r.ok ? r.json() : { tcg_live_handle: null }))
      .then((j) => {
        if (!cancelled) setSavedHandle(j.tcg_live_handle ?? null);
      })
      .catch(() => {
        if (!cancelled) setSavedHandle(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ─── Actions ──────────────────────────────────────────────── */

  function handleAnalyze() {
    setError(null);
    const text = raw.trim();
    if (text.length < 50) {
      setError("Paste a full TCG Live battle log to import.");
      return;
    }
    const parsed = parseBattleLog(text);
    if (parsed.handles.length < 2) {
      setError(
        "Couldn't detect both players in that log. Make sure you copied the entire export.",
      );
      return;
    }

    setHandles(parsed.handles.slice(0, 2));
    setUnmatchedCount(parsed.unmatched.length);

    // Auto-pick perspective if the saved handle matches one of the detected.
    let initial: string;
    if (
      savedHandle &&
      parsed.handles.slice(0, 2).some(
        (h) => h.toLowerCase() === savedHandle.toLowerCase(),
      )
    ) {
      initial = parsed.handles
        .slice(0, 2)
        .find((h) => h.toLowerCase() === savedHandle.toLowerCase())!;
      setSavePromptVisible(false);
    } else {
      initial = parsed.handles[0];
      setSavePromptVisible(!savedHandle); // offer to save only if none stored
    }
    setPlayerHandle(initial);

    const normalized = normalizePerspective(parsed, initial);
    const sum = summarize(normalized);
    setSummary(sum);
    setResult(sum.result);
    setPhase("review");
  }

  function handlePickPlayer(h: string) {
    setPlayerHandle(h);
    // Re-derive summary for the new perspective.
    const parsed = parseBattleLog(raw.trim());
    const normalized = normalizePerspective(parsed, h);
    const sum = summarize(normalized);
    setSummary(sum);
    setResult(sum.result);
    // If the user just picked a handle we don't have stored, offer to save it.
    if (!savedHandle) setSavePromptVisible(true);
  }

  function handleArchetypeChange(val: string) {
    setOpponentArchetype(val);
    if (val.trim().length > 0) {
      const lower = val.toLowerCase();
      setSuggestions(
        META_ARCHETYPES.filter((a) => a.toLowerCase().includes(lower)).slice(0, 6),
      );
      setShowSuggestions(true);
    } else {
      setSuggestions(META_ARCHETYPES.slice(0, 8));
      setShowSuggestions(false);
    }
  }

  async function handleSubmit() {
    if (!playerHandle || !result) {
      setError("Pick a result before saving.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (savePromptVisible && savePromptChecked) {
        // Fire-and-forget; the import succeeds even if this fails.
        fetch("/api/profile/tcg-live-handle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tcg_live_handle: playerHandle }),
        }).catch(() => {});
      }

      const res = await fetch("/api/matches/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saved_deck_id: savedDeckId,
          battle_log_raw: raw.trim(),
          player_handle: playerHandle,
          result_override: result,
          opponent_archetype: opponentArchetype.trim() || null,
          notes: notes.trim() || null,
          played_at: showDateField
            ? new Date(matchDate + "T12:00:00").toISOString()
            : null,
          tz: clientTz(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to import match.");
      celebrateStreak(json.streak);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ─── Render ───────────────────────────────────────────────── */

  const opponentHandle = useMemo(() => {
    if (!playerHandle) return null;
    return handles.find((h) => h !== playerHandle) ?? null;
  }, [handles, playerHandle]);

  if (phase === "paste") {
    return (
      <div key="paste" className="pt-2 animate-tab-fade">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste here"
          rows={10}
          className="w-full mb-2 rounded-lg bg-bg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-y [font-size:16px] sm:text-xs"
        />
        <p className="text-xs text-text-muted mb-3">
          After your match ends, click <span className="font-semibold">Battle Log</span>, then click <span className="font-semibold">Export</span> to copy to your clipboard.
        </p>

        {error && <p className="text-xs text-accent mb-2">{error}</p>}

        <div data-match-actions className="flex gap-2">
          <button
            onClick={handleAnalyze}
            disabled={raw.trim().length < 50}
            className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Analyze
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

  // ── Review phase ──────────────────────────────────────────────
  return (
    <div key="review" className="pt-2 animate-tab-fade">
      {/* Handle picker */}
      <div className="mb-3">
        <p className="text-xs font-semibold text-text-secondary mb-2">
          Which player is you?
        </p>
        <div className="flex gap-2">
          {handles.map((h) => {
            const selected = playerHandle === h;
            return (
              <button
                key={h}
                onClick={() => handlePickPlayer(h)}
                className={`flex-1 rounded-full py-2 text-sm font-semibold transition-all truncate ${
                  selected
                    ? "bg-gradient-brand text-white"
                    : "bg-bg text-text-secondary shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
                }`}
              >
                {h}
              </button>
            );
          })}
        </div>
        {savePromptVisible && playerHandle && (
          <label className="mt-2 flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={savePromptChecked}
              onChange={(e) => setSavePromptChecked(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Save <span className="font-semibold">{playerHandle}</span> as my TCG Live username for future imports.
            </span>
          </label>
        )}
      </div>

      {/* Result picker (preselected from log) */}
      <div className="flex gap-2 mb-3">
        {(["win", "loss", "draw"] as const).map((r) => {
          const s = RESULT_STYLE[r];
          const selected = result === r;
          return (
            <button
              key={r}
              onClick={() => setResult(r)}
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

      {/* Derived summary preview */}
      {summary && (
        <div className="mb-3 rounded-lg bg-bg p-3 text-xs text-text-secondary">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-text-muted">Opponent:</span>{" "}
              <span className="font-semibold text-text-primary">
                {opponentHandle ?? "—"}
              </span>
            </span>
            <span>
              <span className="text-text-muted">Turns:</span>{" "}
              <span className="font-semibold text-text-primary">{summary.total_turns}</span>
            </span>
            <span>
              <span className="text-text-muted">Prizes:</span>{" "}
              <span className="font-semibold text-text-primary">
                {summary.prizes_taken_player}–{summary.prizes_taken_opponent}
              </span>
            </span>
            <span>
              <span className="text-text-muted">First:</span>{" "}
              <span className="font-semibold text-text-primary">
                {summary.went_first === null ? "—" : summary.went_first ? "you" : "opp"}
              </span>
            </span>
            {summary.player_mulligans + summary.opponent_mulligans > 0 && (
              <span>
                <span className="text-text-muted">Mulligans:</span>{" "}
                <span className="font-semibold text-text-primary">
                  {summary.player_mulligans}–{summary.opponent_mulligans}
                </span>
              </span>
            )}
          </div>
          {unmatchedCount > 0 && (
            <p className="mt-2 text-[11px] text-text-muted">
              {unmatchedCount} line{unmatchedCount === 1 ? "" : "s"} couldn&apos;t be parsed and will be stored as raw text.
            </p>
          )}
        </div>
      )}

      {/* Opponent archetype (autocomplete) */}
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

      {/* Notes */}
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full mb-2 rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
      />

      {/* Date toggle */}
      <div className="flex flex-col items-start gap-1 mb-3">
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
      </div>

      {error && <p className="text-xs text-accent mb-2">{error}</p>}

      <div data-match-actions className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !result || !playerHandle}
          className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? "Saving..." : "Save Match"}
        </button>
        <button
          onClick={() => setPhase("paste")}
          className="rounded-full border border-border bg-bg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-2 transition-all"
        >
          Back
        </button>
      </div>
    </div>
  );
}
