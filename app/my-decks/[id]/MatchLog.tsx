"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MatchForm, { type MatchFormData } from "@/app/components/MatchForm";
import MatchEntry from "@/app/components/MatchEntry";
import BattleLogDetail from "@/app/components/BattleLogDetail";
import {
  deckResult,
  viewerLost,
  type SharedMatchCore,
  type SharedResult,
} from "@/lib/shared-matches";

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
}

export interface SharedDeckMatchRow extends SharedMatchCore {
  /** Display name for the *other* participant on this deck profile. */
  opponent_display_name: string | null;
  opponent_username: string | null;
  opponent_deck_name: string | null;
  opponent_deck_archetype: string | null;
}

interface Props {
  savedDeckId: string;
  initialMatches: Match[];
  /** Verified shared matches involving this deck. Public to all viewers. */
  initialSharedMatches?: SharedDeckMatchRow[];
  /** When true, hides log/edit/delete affordances (visitor view). */
  readOnly?: boolean;
  /** Viewer's user id, or null for unauthenticated. Used for judge-note visibility. */
  viewerId?: string | null;
  /** Controlled form-open state. When provided the parent drives open/close. */
  open?: boolean;
  /** Called when the form should open or close (controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

interface UnifiedRow {
  kind: "manual" | "verified";
  id: string;
  result: SharedResult;
  date: string | null;
  // manual-only
  manual?: Match;
  // verified-only
  verified?: SharedDeckMatchRow;
  showJudgeNote?: boolean;
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
// and app/meta-decks/[slug]/page.tsx — keep them in sync.
const RESULT_STYLE = {
  win:  { label: "W", bg: "bg-gradient-brand",                       text: "text-white"        },
  loss: { label: "L", bg: "bg-black",                                text: "text-white"        },
  draw: { label: "D", bg: "bg-white shadow-[inset_0_0_0_1px_black]", text: "text-text-primary" },
};

/* ─── Component ──────────────────────────────────────────────── */

export default function MatchLog({
  savedDeckId,
  initialMatches,
  initialSharedMatches = [],
  readOnly = false,
  viewerId = null,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logOpenId, setLogOpenId] = useState<string | null>(null);

  // Support both controlled (open prop) and uncontrolled (internal state) modes.
  const [internalOpen, setInternalOpen] = useState(false);
  const formOpen = open !== undefined ? open : internalOpen;

  const [historyExpanded, setHistoryExpanded] = useState(false);

  function closeForm() {
    if (onOpenChange) onOpenChange(false);
    else setInternalOpen(false);
  }

  // ── Unified rows (manual + verified), sorted by date desc ──
  const rows: UnifiedRow[] = useMemo(() => {
    const out: UnifiedRow[] = [];
    for (const m of matches) {
      out.push({
        kind: "manual",
        id: m.id,
        result: m.result,
        date: m.played_at,
        manual: m,
      });
    }
    for (const sm of initialSharedMatches) {
      const r = deckResult(sm, savedDeckId);
      if (!r) continue;
      out.push({
        kind: "verified",
        id: sm.id,
        result: r,
        date: sm.finalized_at ?? null,
        verified: sm,
        showJudgeNote: viewerLost(sm, viewerId) && sm.judge_ruled,
      });
    }
    return out.sort((a, b) => {
      const at = a.date ? Date.parse(a.date) : 0;
      const bt = b.date ? Date.parse(b.date) : 0;
      return bt - at;
    });
  }, [matches, initialSharedMatches, savedDeckId, viewerId]);

  // ── Stats (combined manual + verified) ─────────────────────
  const wins = rows.filter((r) => r.result === "win").length;
  const losses = rows.filter((r) => r.result === "loss").length;
  const draws = rows.filter((r) => r.result === "draw").length;
  const total = wins + losses + draws;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";

  // ── Streak ──────────────────────────────────────────────────
  let streak = 0;
  let streakType: "win" | "loss" | null = null;
  for (const r of rows) {
    if (streakType === null) {
      streakType = r.result === "win" ? "win" : r.result === "loss" ? "loss" : null;
      if (streakType) streak = 1;
    } else if (r.result === streakType) {
      streak++;
    } else {
      break;
    }
  }

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
    <div className="rounded-xl bg-white p-5">
      {/* ── Header + Stats ────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Match Log</h2>
          {total > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-green-700">{wins}W</span>
              <span className="text-text-muted">-</span>
              <span className="font-semibold text-accent">{losses}L</span>
              {draws > 0 && (
                <>
                  <span className="text-text-muted">-</span>
                  <span className="font-semibold text-stone-600">{draws}D</span>
                </>
              )}

              {streak >= 3 && streakType === "win" && (
                <span className="text-xs font-bold text-green-600 ml-1">
                  {streak}W streak
                </span>
              )}
            </div>
          )}
        </div>

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
            ? "No verified matches yet."
            : "No matches logged yet. Tap Log Match after your next game."}
        </p>
      )}

      {/* ── Match List ────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="mt-4 flex flex-col">
          {(historyExpanded ? rows : rows.slice(0, 3)).map((row, i, arr) => {
            const s = RESULT_STYLE[row.result];
            const dateStr = row.date
              ? new Date(row.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : null;

            if (row.kind === "manual") {
              const match = row.manual!;
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
                      }}
                      onSubmit={(data) => handleEditMatch(match.id, data)}
                      onCancel={() => setEditingId(null)}
                      submitLabel="Update Match"
                    />
                  </div>
                );
              }
              const hasLog = match.source === "tcg_live_log";
              const logOpen = logOpenId === match.id;
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
                        {match.opponent_archetype && (
                          <span className="font-semibold text-text-primary truncate">
                            vs {match.opponent_archetype}
                          </span>
                        )}
                        {match.opponent_name && !match.opponent_archetype && (
                          <span className="font-semibold text-text-primary truncate">
                            vs {match.opponent_name}
                          </span>
                        )}
                        {match.opponent_name && match.opponent_archetype && (
                          <span className="text-xs text-text-muted truncate">
                            ({match.opponent_name})
                          </span>
                        )}
                        {!match.opponent_archetype && !match.opponent_name && (
                          <span className="text-text-muted text-sm">Match logged</span>
                        )}
                      </div>
                      {match.notes && (
                        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                          {match.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {dateStr && (
                        <span className="text-xs text-text-muted">{dateStr}</span>
                      )}
                      {hasLog && (
                        <button
                          onClick={() =>
                            setLogOpenId((prev) => (prev === match.id ? null : match.id))
                          }
                          className={`transition-colors ${
                            logOpen
                              ? "text-accent"
                              : "text-text-muted/50 hover:text-accent"
                          }`}
                          aria-label={logOpen ? "Hide battle log" : "View battle log"}
                          aria-expanded={logOpen}
                          title={logOpen ? "Hide battle log" : "View battle log"}
                        >
                          {/* clipboard-list / log icon */}
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6a1 1 0 011 1v1h3a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h3V5a1 1 0 011-1z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h6M9 8h6" />
                          </svg>
                        </button>
                      )}
                      {!readOnly && (
                        <>
                          <button
                            onClick={() => { setEditingId(match.id); closeForm(); }}
                            className="text-text-muted/50 hover:text-accent transition-colors"
                            title="Edit match"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(match.id)}
                            className="text-text-muted/50 hover:text-accent transition-colors"
                            title="Delete match"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {hasLog && logOpen && <BattleLogDetail matchId={match.id} />}
                </div>
              );
            }

            // verified row
            const sm = row.verified!;
            return (
              <Link
                key={sm.id}
                href={`/matches/${sm.id}`}
                className={`flex items-start gap-3 px-1 py-3 hover:bg-black/[0.02] transition-colors ${
                  i < arr.length - 1 ? "border-b border-border/50" : ""
                }`}
              >
                <span
                  className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${s.bg} ${s.text}`}
                >
                  {s.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-text-primary truncate">
                      vs {sm.opponent_display_name ?? "Opponent"}
                    </span>
                    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Verified
                    </span>
                  </div>
                  {sm.opponent_deck_archetype && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">
                      {sm.opponent_deck_archetype}
                    </p>
                  )}
                  {row.showJudgeNote && (
                    <p className="text-xs text-text-secondary mt-0.5 italic">
                      Result determined by judge ruling.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {dateStr && (
                    <span className="text-xs text-text-muted">{dateStr}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
