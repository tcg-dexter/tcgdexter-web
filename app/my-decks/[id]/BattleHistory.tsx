"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BattleForm, { type BattleFormData } from "@/app/components/BattleForm";
import BattleEntry from "@/app/components/BattleEntry";
import BattleCardMenu from "@/app/components/BattleCardMenu";
import { BattleCard, type RecentBattle } from "@/app/components/BattleCard";
import CarouselChevron from "@/app/cards/[id]/CarouselChevron";
import { useCarousel } from "@/app/cards/[id]/useCarousel";
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
  /** Raw battle rows — the edit form's prefill source, and what the
   *  result tallies upstream are counted from. */
  initialBattles: Battle[];
  /** The same battles as assembled preview cards (server-built: opponent
   *  hero art, prize counts, colours). Ordered newest-played first. */
  battleCards: RecentBattle[];
  /** When true, hides log/edit/delete affordances (visitor view). */
  readOnly?: boolean;
  /** Controlled form-open state. When provided the parent drives open/close. */
  open?: boolean;
  /** Called when the form should open or close (controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

/** Tiles advanced per chevron press. Tile width is fixed (see TILE_CLS), so
 *  this only needs to distinguish "one card visible" from "several". */
const DESKTOP_MQ = "(min-width: 640px)";

/** One card per screen on mobile, minus a sliver so the next card peeks in
 *  and the rail reads as scrollable without a visible scrollbar. */
const TILE_CLS = "shrink-0 basis-[86%] max-w-[360px] sm:basis-[320px] snap-start";

/* ─── Component ──────────────────────────────────────────────── */

export default function BattleHistory({
  savedDeckId,
  initialBattles,
  battleCards,
  readOnly = false,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Ids dropped locally so a deleted card disappears on the tap rather than
  // when the server round-trip lands. Stale entries after a refresh are
  // harmless — they no longer match anything.
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  // Support both controlled (open prop) and uncontrolled (internal state) modes.
  const [internalOpen, setInternalOpen] = useState(false);
  const formOpen = open !== undefined ? open : internalOpen;

  function closeForm() {
    if (onOpenChange) onOpenChange(false);
    else setInternalOpen(false);
  }

  // Cards come from the server already assembled and sorted; the only local
  // edit is the optimistic delete. New and edited battles can't be rebuilt
  // client-side (opponent art and prize counts are server-resolved), so
  // those paths call router.refresh() and re-read this prop.
  const cards = useMemo(
    () => battleCards.filter((c) => !removedIds.includes(c.id)),
    [battleCards, removedIds],
  );

  const editing = useMemo(
    () => initialBattles.find((b) => b.id === editingId) ?? null,
    [initialBattles, editingId],
  );

  // A form takes the rail's place while it's open, so the scroller really
  // unmounts and remounts around it.
  const showRail = cards.length > 0 && !formOpen && !editing;

  const tilesPerView = useCallback(
    () => (window.matchMedia(DESKTOP_MQ).matches ? 2 : 1),
    [],
  );
  const { scrollerRef, listRef, itemRef, atStart, atEnd, step } = useCarousel({
    tilesPerView,
    // useCarousel re-measures and re-binds its scroll listener whenever this
    // changes, so the mounted-ness has to be folded in: coming back from a
    // form, the hook is looking at a brand new node that its listener isn't
    // attached to, even though the card count never moved.
    itemCount: showRail ? cards.length : -1,
  });

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
    setEditingId(null);
    router.refresh();
  }

  async function handleDelete(battleId: string) {
    setRemovedIds((prev) => [...prev, battleId]);
    try {
      const res = await fetch(`/api/matches/${battleId}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setRemovedIds((prev) => prev.filter((id) => id !== battleId));
      }
    } catch {
      setRemovedIds((prev) => prev.filter((id) => id !== battleId));
    }
  }

  return (
    <div>
      {/* ── Header ────────────────────────────────────────── */}
      {!formOpen && !editing && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Battle History</h2>
          {cards.length > 1 && (
            <div className="flex items-center gap-1.5">
              <CarouselChevron
                direction="left"
                noun="battles"
                disabled={atStart}
                onClick={() => step(-1)}
              />
              <CarouselChevron
                direction="right"
                noun="battles"
                disabled={atEnd}
                onClick={() => step(1)}
              />
            </div>
          )}
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

      {/* ── Edit form — takes the rail's place while open ─── */}
      {!readOnly && !formOpen && editing && (
        <div className="mb-4">
          <BattleForm
            initial={{
              result: editing.result,
              opponent_name: editing.opponent_name,
              opponent_archetype: editing.opponent_archetype,
              opponent_deck_list: editing.opponent_deck_list,
              notes: editing.notes,
              played_at: editing.played_at,
              game_results: editing.game_results,
              prizes_taken_player: editing.prizes_taken_player,
              prizes_taken_opponent: editing.prizes_taken_opponent,
              game_prizes: editing.game_prizes,
            }}
            onSubmit={(data) => handleEditBattle(editing.id, data)}
            onCancel={() => setEditingId(null)}
            submitLabel="Update Battle"
          />
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────── */}
      {cards.length === 0 && !formOpen && (
        <p className="text-sm text-text-muted mt-3 text-center">
          {readOnly
            ? "No battles yet."
            : "No battles logged yet. Tap Log Battle after your next game."}
        </p>
      )}

      {/* ── Battle rail ───────────────────────────────────── */}
      {showRail && (
        <div
          ref={scrollerRef}
          // Bleeds to the viewport edges through DeckProfileView's px-6 so
          // cards scroll out of frame rather than stopping short of it, then
          // re-pads the content back to the column's own gutter.
          className="-mx-6 px-6 overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar scroll-pl-6"
          aria-label="Battles logged with this deck"
        >
          <ul ref={listRef} className="flex gap-3 items-stretch">
            {cards.map((card, i) => (
              <li
                key={card.id}
                ref={i === 0 ? itemRef : undefined}
                className={TILE_CLS}
              >
                <BattleCard
                  battle={card}
                  actions={
                    readOnly ? undefined : (
                      <BattleCardMenu
                        onEdit={() => {
                          setEditingId(card.id);
                          closeForm();
                        }}
                        onDelete={() => handleDelete(card.id)}
                      />
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
