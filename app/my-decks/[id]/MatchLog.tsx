"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MatchForm, { type MatchFormData } from "@/app/components/MatchForm";
import MatchEntry from "@/app/components/MatchEntry";
import { WLCircles } from "@/app/components/DeckPostCard";
import type { GamePrize } from "@/lib/bo3";

/* ─── Types ──────────────────────────────────────────────────── */

interface Match {
  id: string;
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string | null;
  source?: "manual" | "tcg_live_log";
  /** Best-of-3 ordered per-game sequence (e.g. "WLW"); null for single games. */
  game_results?: string | null;
  prizes_taken_player?: number | null;
  prizes_taken_opponent?: number | null;
  game_prizes?: GamePrize[] | null;
}

interface Props {
  savedDeckId: string;
  initialMatches: Match[];
  /** When true, hides log/edit/delete affordances (visitor view). */
  readOnly?: boolean;
  /** Controlled form-open state. When provided the parent drives open/close. */
  open?: boolean;
  /** Called when the form should open or close (controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

/* ─── Result styling ─────────────────────────────────────────── */

// Mirrors the gradient-button pattern from ShareButton in
// DeckProfileView's footer (rounded-full + bg-gradient-brand, no border
// at all) — that's the only configuration that renders cleanly with the
// rounded shape in every browser. The earlier border-image attempt failed
// to clip to border-radius on the meta-deck profile and rendered as a
// visible rectangle around the chip.
//
// Win and loss therefore ship no border; tie keeps its 1 px black outline
// via `shadow-[inset_0_0_0_1px_black]` (inset box-shadow doesn't grow the
// box the way a real `border` does, so the three chips still render at
// identical pixel dimensions). Mirrored in app/components/MatchForm.tsx
// and app/meta-archetypes/[slug]/page.tsx — keep them in sync.
const RESULT_STYLE = {
  win:  { label: "W", bg: "bg-gradient-brand",                       text: "text-white"        },
  loss: { label: "L", bg: "bg-black",                                text: "text-white"        },
  draw: { label: "D", bg: "bg-white shadow-[inset_0_0_0_1px_black]", text: "text-text-primary" },
};

/* ─── Component ──────────────────────────────────────────────── */

export default function MatchLog({
  savedDeckId,
  initialMatches,
  readOnly = false,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Support both controlled (open prop) and uncontrolled (internal state) modes.
  const [internalOpen, setInternalOpen] = useState(false);
  const formOpen = open !== undefined ? open : internalOpen;

  const [historyExpanded, setHistoryExpanded] = useState(false);

  function closeForm() {
    if (onOpenChange) onOpenChange(false);
    else setInternalOpen(false);
  }

  // ── Rows (manual matches), sorted by date desc ─────────────
  const rows = useMemo(() => {
    return [...matches].sort((a, b) => {
      const at = a.played_at ? Date.parse(a.played_at) : 0;
      const bt = b.played_at ? Date.parse(b.played_at) : 0;
      return bt - at;
    });
  }, [matches]);

  // ── Stats ───────────────────────────────────────────────────
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  const draws = rows.filter((r) => r.result === "draw").length;
  const total = wins + losses + draws;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";

  async function handleNewMatch(data: MatchFormData) {
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved_deck_id: savedDeckId, ...data }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error ?? "Failed to log match.");
    }
    const newMatch: Match = {
      id: json.id,
      result: data.result,
      opponent_name: data.opponent_name ?? null,
      opponent_archetype: data.opponent_archetype ?? null,
      opponent_deck_list: data.opponent_deck_list ?? null,
      notes: data.notes ?? null,
      played_at: data.played_at ?? null,
      game_results: data.game_results ?? null,
      prizes_taken_player: data.prizes_taken_player ?? null,
      prizes_taken_opponent: data.prizes_taken_opponent ?? null,
      game_prizes: data.game_prizes ?? null,
    };
    setMatches((prev) => [newMatch, ...prev]);
    closeForm();
    router.refresh();
  }

  async function handleEditMatch(matchId: string, data: MatchFormData) {
    const res = await fetch(`/api/matches/${matchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to update match.");
    }
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId
          ? {
              ...m,
              result: data.result,
              opponent_name: data.opponent_name ?? null,
              opponent_archetype: data.opponent_archetype ?? null,
              opponent_deck_list: data.opponent_deck_list ?? null,
              notes: data.notes ?? null,
              played_at: data.played_at ?? null,
              game_results: data.game_results ?? null,
              prizes_taken_player: data.prizes_taken_player ?? null,
              prizes_taken_opponent: data.prizes_taken_opponent ?? null,
              game_prizes: data.game_prizes ?? null,
            }
          : m
      )
    );
    setEditingId(null);
    router.refresh();
  }

  async function handleDelete(matchId: string) {
    if (!confirm("Delete this match?")) return;
    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
      if (res.ok) {
        setMatches((prev) => prev.filter((m) => m.id !== matchId));
        router.refresh();
      }
    } catch {
      // silent
    }
  }

  return (
    <div>
      {/* ── Header + Stats ────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Match Log</h2>

        <div className="flex items-center gap-3">
          {total > 0 && <WLCircles wl={{ w: wins, l: losses, d: draws }} />}

          {total > 3 && (
            <button
              onClick={() => setHistoryExpanded((v) => !v)}
              aria-label={historyExpanded ? "Collapse match history" : "Expand match history"}
              aria-expanded={historyExpanded}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
            >
              {historyExpanded ? "Less" : "More"}
              <svg
                className={`w-4 h-4 transition-transform ${historyExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── New match form (shown when formOpen) ─────────── */}
      {!readOnly && formOpen && (
        <div className="mb-4">
          <MatchEntry
            savedDeckId={savedDeckId}
            onSubmitManual={handleNewMatch}
            onImported={() => {
              closeForm();
              router.refresh();
            }}
            onCancel={closeForm}
          />
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────── */}
      {rows.length === 0 && !formOpen && (
        <p className="text-sm text-text-muted mt-3 text-center">
          {readOnly
            ? "No matches yet."
            : "No matches logged yet. Tap Log Match after your next game."}
        </p>
      )}

      {/* ── Match List ────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="mt-4 flex flex-col">
          {(historyExpanded ? rows : rows.slice(0, 3)).map((match, i, arr) => {
            const s = RESULT_STYLE[match.result];
            const score =
              match.prizes_taken_player != null || match.prizes_taken_opponent != null
                ? `${match.prizes_taken_player ?? 0}–${match.prizes_taken_opponent ?? 0}`
                : null;
            const subtitle =
              score && match.opponent_name
                ? `${score} v ${match.opponent_name}`
                : score ?? match.opponent_name;

            const isEditing = editingId === match.id;
            if (isEditing && !readOnly) {
              return (
                <div
                  key={match.id}
                  className={`py-3 ${i < arr.length - 1 ? "border-b border-border/50" : ""}`}
                >
                  <MatchForm
                    initial={{
                      result: match.result,
                      opponent_name: match.opponent_name,
                      opponent_archetype: match.opponent_archetype,
                      opponent_deck_list: match.opponent_deck_list,
                      notes: match.notes,
                      played_at: match.played_at,
                      game_results: match.game_results,
                      prizes_taken_player: match.prizes_taken_player,
                      prizes_taken_opponent: match.prizes_taken_opponent,
                      game_prizes: match.game_prizes,
                    }}
                    onSubmit={(data) => handleEditMatch(match.id, data)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Update Match"
                  />
                </div>
              );
            }
            const hasLog = match.source === "tcg_live_log";
            const isExpanded = expandedId === match.id;
            const canExpand = Boolean(match.notes) || !readOnly;
            return (
              <div
                key={match.id}
                className={`px-1 py-3 ${
                  i < arr.length - 1 ? "border-b border-border/50" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${s.bg} ${s.text}`}
                  >
                    {s.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      {match.opponent_archetype ? (
                        <span className="font-semibold text-text-primary truncate">
                          {match.opponent_archetype}
                        </span>
                      ) : (
                        <span className="text-text-muted text-sm">Match logged</span>
                      )}
                      {match.game_results && match.game_results.length >= 2 && (
                        <span
                          className="flex flex-shrink-0 items-center"
                          title={`Best of 3 — ${match.game_results}`}
                          aria-label={`Best of 3 result: ${match.game_results}`}
                        >
                          {/* Overlapping W/L pills — mirrors the avatar stack
                              on deck preview cards (ring-2 ring-white + -ml). */}
                          {match.game_results.split("").map((g, i) => {
                            const s =
                              g === "W"
                                ? RESULT_STYLE.win
                                : g === "L"
                                ? RESULT_STYLE.loss
                                : RESULT_STYLE.draw;
                            return (
                              <span
                                key={i}
                                aria-hidden
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-white ${s.bg} ${s.text} ${i === 0 ? "" : "-ml-2"}`}
                              >
                                {g}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </div>
                    {subtitle && (
                      <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {hasLog && (
                      <Link
                        href={`/battles/${match.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold text-text-primary hover:bg-black/5 transition-colors"
                      >
                        View Battle
                      </Link>
                    )}
                    {canExpand && (
                      <button
                        onClick={() =>
                          setExpandedId((prev) => (prev === match.id ? null : match.id))
                        }
                        aria-label={isExpanded ? "Hide match details" : "Show match details"}
                        aria-expanded={isExpanded}
                        className="text-text-muted/60 hover:text-text-primary transition-colors"
                      >
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-2 ml-11 flex flex-col gap-3">
                    {match.notes && (
                      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                        {match.notes}
                      </p>
                    )}
                    {!readOnly && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingId(match.id); closeForm(); }}
                          className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-black/5 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(match.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-accent/30 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/5 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
