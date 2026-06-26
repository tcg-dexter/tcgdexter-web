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

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <MatchesClient
        matches={matches}
        leaderboard={leaderboard}
        currentUsername={currentUsername}
      />
    </main>
  );
}
