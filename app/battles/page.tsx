import {
  FEATURED_BATTLE_POOL,
  loadRecentBattles,
  pickFeaturedBattle,
} from "@/lib/recent-battles";
import { loadPlayerLeaderboard } from "@/lib/player-leaderboard";
import { loadBattleSideStats } from "@/lib/battle-side-stats";
import { createClient } from "@/lib/supabase/server";
import BattlesClient from "./BattlesClient";

export const revalidate = 60;

export default async function BattlesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let currentUsername: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle<{ username: string }>();
    currentUsername = profile?.username ?? null;
  }

  const [battles, leaderboard] = await Promise.all([
    loadRecentBattles(FEATURED_BATTLE_POOL),
    loadPlayerLeaderboard(),
  ]);

  // Shared with the home page's showcase so both name the same battle — see
  // pickFeaturedBattle.
  const featuredBattle = pickFeaturedBattle(battles);

  // Per-side stat table for the featured battle's Details drawer. Aggregated
  // server-side up front so the drawer opens without a client fetch (and
  // stays SSR-render-consistent). The cost is one small match_actions query.
  const featuredBattleStats = featuredBattle
    ? await loadBattleSideStats(featuredBattle.id)
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <BattlesClient
        battles={battles}
        featuredBattle={featuredBattle}
        featuredBattleStats={featuredBattleStats}
        leaderboard={leaderboard}
        currentUsername={currentUsername}
        initialMyBattles={searchParams.filter === "mine"}
      />
    </main>
  );
}
