import {
  FEATURED_MATCH_POOL,
  loadRecentMatches,
  pickFeaturedMatch,
} from "@/lib/recent-matches";
import { loadPlayerLeaderboard } from "@/lib/player-leaderboard";
import { loadMatchSideStats } from "@/lib/match-side-stats";
import { createClient } from "@/lib/supabase/server";
import MatchesClient from "./MatchesClient";

export const revalidate = 60;

export default async function MatchesPage({
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

  const [matches, leaderboard] = await Promise.all([
    loadRecentMatches(FEATURED_MATCH_POOL),
    loadPlayerLeaderboard(),
  ]);

  // Shared with the home page's showcase so both name the same match — see
  // pickFeaturedMatch.
  const featuredMatch = pickFeaturedMatch(matches);

  // Per-side stat table for the featured match's Details drawer. Aggregated
  // server-side up front so the drawer opens without a client fetch (and
  // stays SSR-render-consistent). The cost is one small match_actions query.
  const featuredMatchStats = featuredMatch
    ? await loadMatchSideStats(featuredMatch.id)
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <MatchesClient
        matches={matches}
        featuredMatch={featuredMatch}
        featuredMatchStats={featuredMatchStats}
        leaderboard={leaderboard}
        currentUsername={currentUsername}
        initialMyMatches={searchParams.filter === "mine"}
      />
    </main>
  );
}
