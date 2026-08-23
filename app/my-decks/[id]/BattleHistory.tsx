"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BattleForm, { type BattleFormData } from "@/app/components/BattleForm";
import BattleEntry from "@/app/components/BattleEntry";
import type { GamePrize } from "@/lib/bo3";
import { clientTz, celebrateStreak } from "@/lib/streak-client";

/* ─── Types ──────────────────────────────────────────────────── */

interface Battle {
  id: string;
  /** Short, shareable id used in the /battles URL (never the UUID). */
  short_id: string;
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
  initialBattles: Battle[];
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
// identical pixel dimensions). Mirrored in app/components/BattleForm.tsx
// and app/meta-archetypes/[slug]/page.tsx — keep them in sync.
const RESULT_STYLE = {
  win: { label: "W", bg: "bg-gradient-brand", text: "text-white" },
  loss: { label: "L", bg: "bg-black dark:bg-white", text: "text-white dark:text-black" },
  draw: {
    label: "D",
    bg: "bg-white dark:bg-surface-elevated shadow-[inset_0_0_0_1px_black] dark:shadow-[inset_0_0_0_1px_white]",
    text: "text-text-primary",
  },
};

/* ─── Component ──────────────────────────────────────────────── */

export default function BattleHistory({
  savedDeckId,
  initialBattles,
  readOnly = false,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [battles, setBattles] = useState<Battle[]>(initialBattles);
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

  // ── Rows (manual battles), sorted by date desc ─────────────
  const rows = useMemo(() => {
    return [...battles].sort((a, b) => {
      const at = a.played_at ? Date.parse(a.played_at) : 0;
      const bt = b.played_at ? Date.parse(b.played_at) : 0;
      return bt - at;
    });
  }, [battles]);

  // ── Stats ───────────────────────────────────────────────────
  const total = rows.length;

  async function handleNewBattle(data: BattleFormData) {
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved_deck_id: savedDeckId, ...data, tz: clientTz() }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error ?? "Failed to log battle.");
    }
    celebrateStreak(json.streak);
    const newBattle: Battle = {
      id: json.id,
      short_id: json.short_id,
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
    setBattles((prev) => [newBattle, ...prev]);
    closeForm();
    router.refresh();
  }

  async function handleEditBattle(battleId: string, data: BattleFormData) {
    const res = await fetch(`/api/matches/${battleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to update battle.");
    }
    setBattles((prev) =>
      prev.map((m) =>
        m.id === battleId
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

  async function handleDelete(battleId: string) {
    if (!confirm("Delete this battle?")) return;
    try {
      const res = await fetch(`/api/matches/${battleId}`, { method: "DELETE" });
      if (res.ok) {
        setBattles((prev) => prev.filter((m) => m.id !== battleId));
        router.refresh();
      }
    } catch {
      // silent
    }
  }

  return (
    <div>
      {/* ── Header + Stats ────────────────────────────────── */}
      {!formOpen && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Battle History</h2>

          <div className="flex items-center gap-3">
            {total > 3 && (
              <button
                onClick={() => setHistoryExpanded((v) => !v)}
                aria-label={historyExpanded ? "Collapse battle history" : "Expand battle history"}
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
      )}

      {/* ── New battle form (shown when formOpen) ─────────── */}
      {!readOnly && formOpen && (
        <div className="mb-4">
          <BattleEntry
            savedDeckId={savedDeckId}
            onSubmitManual={handleNewBattle}
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
            ? "No battles yet."
            : "No battles logged yet. Tap Log Battle after your next game."}
        </p>
      )}

      {/* ── Battle List ────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="mt-4 flex flex-col">
          {(historyExpanded ? rows : rows.slice(0, 3)).map((battle, i, arr) => {
            const s = RESULT_STYLE[battle.result];
            const score =
              battle.prizes_taken_player != null || battle.prizes_taken_opponent != null
                ? `${battle.prizes_taken_player ?? 0}–${battle.prizes_taken_opponent ?? 0}`
                : null;
            const subtitle =
              score && battle.opponent_name
                ? `${score} v ${battle.opponent_name}`
                : score ?? battle.opponent_name;

            const isEditing = editingId === battle.id;
            if (isEditing && !readOnly) {
              return (
                <div
                  key={battle.id}
                  className={`py-3 ${i < arr.length - 1 ? "border-b border-border/50" : ""}`}
                >
                  <BattleForm
                    initial={{
                      result: battle.result,
                      opponent_name: battle.opponent_name,
                      opponent_archetype: battle.opponent_archetype,
                      opponent_deck_list: battle.opponent_deck_list,
                      notes: battle.notes,
                      played_at: battle.played_at,
                      game_results: battle.game_results,
                      prizes_taken_player: battle.prizes_taken_player,
                      prizes_taken_opponent: battle.prizes_taken_opponent,
                      game_prizes: battle.game_prizes,
                    }}
                    onSubmit={(data) => handleEditBattle(battle.id, data)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Update Battle"
                  />
                </div>
              );
            }
            const hasLog = battle.source === "tcg_live_log";
            const isExpanded = expandedId === battle.id;
            const canExpand = Boolean(battle.notes) || !readOnly;
            return (
              <div
                key={battle.id}
                className={`pr-1 py-3 ${
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
                      {battle.opponent_archetype ? (
                        <span className="font-semibold text-text-primary truncate">
                          {battle.opponent_archetype}
                        </span>
                      ) : (
                        <span className="text-text-muted text-sm">Battle logged</span>
                      )}
                      {battle.game_results && battle.game_results.length >= 2 && (
                        <span
                          className="flex flex-shrink-0 items-center"
                          title={`Best of 3 — ${battle.game_results}`}
                          aria-label={`Best of 3 result: ${battle.game_results}`}
                        >
                          {/* Overlapping W/L pills — mirrors the avatar stack
                              on deck preview cards (ring-2 ring-white + -ml). */}
                          {battle.game_results.split("").map((g, i) => {
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
                        href={`/battles/${battle.short_id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 px-3 py-1 text-[11px] font-semibold text-text-primary hover:bg-black/5 transition-colors"
                      >
                        View Battle
                      </Link>
                    )}
                    {canExpand && (
                      <button
                        onClick={() =>
                          setExpandedId((prev) => (prev === battle.id ? null : battle.id))
                        }
                        aria-label={isExpanded ? "Hide battle details" : "Show battle details"}
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
                    {battle.notes && (
                      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                        {battle.notes}
                      </p>
                    )}
                    {!readOnly && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingId(battle.id); closeForm(); }}
                          className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-black/5 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(battle.id)}
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
