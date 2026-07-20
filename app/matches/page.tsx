import { loadRecentMatches } from "@/lib/recent-matches";
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
    loadRecentMatches(200),
    loadPlayerLeaderboard(),
  ]);

  // Featured Match: within the last 7 days, the match with the most
  // total damage dealt across both sides. Rank ties by createdAt (most
  // recent wins) so the fresher of two similar bloodbaths surfaces.
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const featuredMatch =
    matches
      .filter(
        (m) =>
          m.totalDamage != null &&
          new Date(m.createdAt).getTime() >= sevenDaysAgoMs,
      )
      .sort((a, b) => {
        const dt = (b.totalDamage ?? 0) - (a.totalDamage ?? 0);
        if (dt !== 0) return dt;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] ?? null;

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
