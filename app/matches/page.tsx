import { loadRecentMatches } from "@/lib/recent-matches";
import { loadPlayerLeaderboard } from "@/lib/player-leaderboard";
import { createClient } from "@/lib/supabase/server";
import MatchesClient from "./MatchesClient";

export const revalidate = 60;

export default async function MatchesPage() {
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

  // Match of the Week: within the last 7 days, the match with the highest
  // total_turns. Rank ties by createdAt (most recent wins) so a repeat
  // long-slog on the same day picks up the fresher of the two.
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const matchOfWeek =
    matches
      .filter(
        (m) =>
          m.totalTurns != null &&
          new Date(m.createdAt).getTime() >= sevenDaysAgoMs,
      )
      .sort((a, b) => {
        const dt = (b.totalTurns ?? 0) - (a.totalTurns ?? 0);
        if (dt !== 0) return dt;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] ?? null;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <MatchesClient
        matches={matches}
        matchOfWeek={matchOfWeek}
        leaderboard={leaderboard}
        currentUsername={currentUsername}
      />
    </main>
  );
}
