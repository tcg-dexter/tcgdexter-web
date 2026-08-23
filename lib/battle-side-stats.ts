import { createAdminClient } from "@/lib/supabase/admin";
import type { BattleSideStats } from "@/app/components/BattleStatChart";

/** Per-side aggregate stats for one battle, shaped for the shared
 *  BattleStatChart. Player + opponent buckets are populated by the same
 *  match_actions → switch-on-action_type reducer the /battles/[id] page
 *  uses, so both surfaces render the same numbers off the same rows. */
export interface BattleSideStatsPair {
  player: BattleSideStats;
  opponent: BattleSideStats;
}

const EMPTY_SIDE: BattleSideStats = {
  damage: 0,
  pokemon: 0,
  supporters: 0,
  items: 0,
  energy: 0,
  prizes: 0,
};

/**
 * Load per-side stats for a single battle. Returns `null` when the battle
 * has no relevant `match_actions` rows (e.g. manual battles without a
 * parsed battle log). The reducer mirrors the one inline in
 * `app/battles/[id]/page.tsx`; keep the two in sync if the action_type
 * set or payload shape ever changes.
 */
export async function loadBattleSideStats(
  battleId: string,
): Promise<BattleSideStatsPair | null> {
  try {
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("match_actions")
      .select("actor, action_type, payload")
      .eq("match_id", battleId)
      .in("action_type", [
        "attack",
        "play_to_active",
        "play_to_bench",
        "play_supporter",
        "play_item",
        "attach_energy",
        "prize_taken",
      ]);

    if (error || !rows || rows.length === 0) return null;

    const stats: BattleSideStatsPair = {
      player: { ...EMPTY_SIDE },
      opponent: { ...EMPTY_SIDE },
    };

    for (const row of rows) {
      const side: "player" | "opponent" | null =
        row.actor === "player"
          ? "player"
          : row.actor === "opponent"
            ? "opponent"
            : null;
      if (!side) continue;
      const bucket = stats[side];
      const payload = row.payload as Record<string, unknown> | null;
      switch (row.action_type) {
        case "attack": {
          const damage =
            typeof payload?.damage === "number" ? payload.damage : 0;
          bucket.damage += damage;
          break;
        }
        case "play_to_active":
        case "play_to_bench":
          bucket.pokemon += 1;
          break;
        case "play_supporter":
          bucket.supporters += 1;
          break;
        case "play_item":
          bucket.items += 1;
          break;
        case "attach_energy":
          bucket.energy += 1;
          break;
        case "prize_taken":
          bucket.prizes +=
            typeof payload?.count === "number" && payload.count > 0
              ? payload.count
              : 1;
          break;
      }
    }

    return stats;
  } catch (err) {
    console.error("[battle-side-stats] failed:", err);
    return null;
  }
}
