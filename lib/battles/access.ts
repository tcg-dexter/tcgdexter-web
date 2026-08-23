// Battle visibility — the one place that decides who may see a battle.
//
// Rule (matching app/battles/[id]/page.tsx): the OWNER of the deck the battle
// was logged on can always view it, even while the deck or their profile is
// still private; everyone else needs BOTH the deck and the owner's profile
// to be public. API routes serving battle data must apply this same rule —
// keeping it here prevents the page and its routes from drifting apart.

import type { SupabaseClient } from "@supabase/supabase-js";
import { idColumn } from "@/lib/shortId";

export interface BattleAccess {
  allowed: boolean;
  isOwner: boolean;
  battle: {
    id: string;
    result: string | null;
    battle_log_raw: string | null;
    player_handle: string | null;
    saved_deck_id: string | null;
  } | null;
  deckList: string | null;
}

/**
 * Load a battle and decide whether `viewerId` (null = anonymous) may see it.
 * `admin` must be the service-role client — visibility is enforced HERE, in
 * application code, exactly as the battles page does it.
 *
 * `battleRef` accepts either the battle's short_id (what battle URLs carry)
 * or its UUID (legacy links). The returned `battle.id` is always the real
 * row id, so callers can key child-table queries off it directly.
 */
export async function loadBattleWithAccess(
  admin: SupabaseClient,
  battleRef: string,
  viewerId: string | null,
): Promise<BattleAccess> {
  const none: BattleAccess = { allowed: false, isOwner: false, battle: null, deckList: null };

  const { data: battle } = await admin
    .from("matches")
    .select("id, result, battle_log_raw, player_handle, saved_deck_id")
    .eq(idColumn(battleRef), battleRef)
    .maybeSingle();
  if (!battle || !battle.saved_deck_id) return none;

  const { data: deck } = await admin
    .from("saved_decks")
    .select("id, user_id, is_public, deck_list")
    .eq("id", battle.saved_deck_id as string)
    .maybeSingle();
  if (!deck) return none;

  const isOwner = viewerId !== null && viewerId === (deck.user_id as string);

  if (!isOwner) {
    if (!(deck.is_public as boolean)) return none;
    const { data: profile } = await admin
      .from("profiles")
      .select("is_public")
      .eq("id", deck.user_id as string)
      .maybeSingle();
    if (!profile?.is_public) return none;
  }

  return {
    allowed: true,
    isOwner,
    battle: {
      id: battle.id as string,
      result: (battle.result as string | null) ?? null,
      battle_log_raw: (battle.battle_log_raw as string | null) ?? null,
      player_handle: (battle.player_handle as string | null) ?? null,
      saved_deck_id: battle.saved_deck_id as string,
    },
    deckList: (deck.deck_list as string | null) ?? null,
  };
}
