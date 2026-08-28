"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBattleLog,
  normalizePerspective,
  summarize,
  type BattleLogSummary,
  type BattleLogParseResult,
} from "@/lib/battle-log";
import { clientTz, celebrateStreak } from "@/lib/streak-client";

/* ─── Meta archetypes (mirrored from BattleForm) ────────────────── */

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

/** Strip a trailing rule-box suffix ("ex", "V", "VMAX", "VSTAR", "GX") off a
 *  battle-log card name so it can be compared against the bare species /
 *  archetype names in META_ARCHETYPES ("Dragapult ex" -> "Dragapult"). */
function normalizeSpeciesName(raw: string): string {
  return raw.replace(/\s+(ex|V|VMAX|VSTAR|GX)$/i, "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `needle` appears in `haystack` as a whole word (both already
 *  lowercased) — used to test a species name against a (possibly compound)
 *  archetype label without matching partial words. */
function hasWord(haystack: string, needle: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}($|\\s)`).test(haystack);
}

/** Best-effort guess at the opponent's meta archetype from the Pokémon they
 *  actually played, so the field isn't left blank after Analyze. Candidates
 *  are ranked by damage dealt first (mirrors resolveOpponentHero's own
 *  gameplay-inference cascade: the top-damage attacker is the strongest
 *  signal), then by how often they were played/evolved into for Pokémon
 *  that never attacked (e.g. an Ogerpon that just sat on the bench).
 *  Adjacent pairs of top candidates are checked against the compound,
 *  two-species archetype labels ("Dragapult Dusknoir") before falling back
 *  to single-species matches, so a partner Pokémon isn't dropped just
 *  because it attacked less than the headliner. Purely a starting point —
 *  the field stays editable. */
function guessOpponentArchetype(normalized: BattleLogParseResult): string | null {
  const attackDamage = new Map<string, number>();
  const playCounts = new Map<string, number>();

  for (const a of normalized.actions) {
    if (a.actor !== "opponent") continue;
    if (a.action_type === "attack") {
      const attacker = typeof a.payload.attacker === "string" ? a.payload.attacker : null;
      const damage = typeof a.payload.damage === "number" ? a.payload.damage : 0;
      if (attacker && damage > 0) {
        const name = normalizeSpeciesName(attacker);
        attackDamage.set(name, (attackDamage.get(name) ?? 0) + damage);
      }
    } else if (a.action_type === "play_to_active" || a.action_type === "play_to_bench") {
      const card = typeof a.payload.card === "string" ? a.payload.card : null;
      if (card) {
        const name = normalizeSpeciesName(card);
        playCounts.set(name, (playCounts.get(name) ?? 0) + 1);
      }
    } else if (a.action_type === "evolve") {
      const to = typeof a.payload.to === "string" ? a.payload.to : null;
      if (to) {
        const name = normalizeSpeciesName(to);
        playCounts.set(name, (playCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Rank: every attacker by damage dealt (highest first), then every
  // played/evolved-into Pokémon that never attacked, by play count. Ties in
  // insertion order are fine here — this only needs to be a reasonable
  // starting guess.
  const byDamage = Array.from(attackDamage.entries()).sort((a, b) => b[1] - a[1]);
  const byPlays = Array.from(playCounts.entries()).sort((a, b) => b[1] - a[1]);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const [name] of [...byDamage, ...byPlays]) {
    if (seen.has(name)) continue;
    seen.add(name);
    candidates.push(name);
  }
  if (candidates.length === 0) return null;

  const lower = candidates.map((c) => c.toLowerCase());

  // Compound (two-species) archetypes first, checking nearby-ranked pairs
  // so a lower-damage partner Pokémon can still complete the match.
  for (let i = 0; i < lower.length; i++) {
    for (let j = i + 1; j < lower.length; j++) {
      const compound = META_ARCHETYPES.find((a) => {
        const al = a.toLowerCase();
        return hasWord(al, lower[i]) && hasWord(al, lower[j]);
      });
      if (compound) return compound;
    }
  }

  // Then single-species: exact label match beats a partial (substring)
  // match, but a lower-ranked candidate's exact match still beats a
  // higher-ranked candidate's partial one.
  for (const name of lower) {
    const exact = META_ARCHETYPES.find((a) => a.toLowerCase() === name);
    if (exact) return exact;
  }
  for (const name of lower) {
    const partial = META_ARCHETYPES.find((a) => hasWord(a.toLowerCase(), name));
    if (partial) return partial;
  }
  return null;
}

// Same chip palette as BattleForm. Keep these in lockstep.
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
  // TCG Live imports default to today's date, like the manual log form.
  const [showDateField, setShowDateField] = useState(true);
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
    setOpponentArchetype(guessOpponentArchetype(normalized) ?? "");
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
    setOpponentArchetype(guessOpponentArchetype(normalized) ?? "");
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
          {submitting ? "Saving..." : "Save Battle"}
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
