import { createAdminClient } from "@/lib/supabase/admin";
import HomeClient, { type RecentMatch } from "./HomeClient";

// Revalidate the home page (and its stat counts) at most once per minute.
export const revalidate = 60;

async function loadStats(): Promise<Array<{ label: string; value: string }>> {
  const format = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-US");

  try {
    const admin = createAdminClient();
    const [decksRes, matchesRes] = await Promise.all([
      admin
        .from("analysis_submissions")
        .select("id", { count: "exact", head: true }),
      admin.from("matches").select("id", { count: "exact", head: true }),
    ]);

    if (decksRes.error) {
      console.error("[home/stats] analysis_submissions count failed:", decksRes.error);
    }
    if (matchesRes.error) {
      console.error("[home/stats] matches count failed:", matchesRes.error);
    }

    return [
      { label: "Decks profiled", value: format(decksRes.error ? null : decksRes.count) },
      { label: "Matches logged", value: format(matchesRes.error ? null : matchesRes.count) },
    ];
  } catch (err) {
    console.error("[home/stats] admin client unavailable:", err);
    return [
      { label: "Decks profiled", value: "—" },
      { label: "Matches logged", value: "—" },
    ];
  }
}

async function loadRecentMatches(): Promise<RecentMatch[]> {
  try {
    const admin = createAdminClient();

    // Find public saved_decks where the owner's profile is also public
    const { data: deckRows, error: deckErr } = await admin
      .from("saved_decks")
      .select("id, name, user_id")
      .eq("is_public", true)
      .limit(200);

    if (deckErr || !deckRows?.length) return [];

    const ownerIds = Array.from(new Set(deckRows.map((d) => d.user_id as string)));
    const { data: profileRows, error: profErr } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", ownerIds)
      .eq("is_public", true);

    if (profErr || !profileRows?.length) return [];

    const pubProfileIds = new Set(profileRows.map((p) => p.id as string));
    const pubDecks = deckRows.filter((d) => pubProfileIds.has(d.user_id as string));
    if (!pubDecks.length) return [];

    const { data: matchRows, error: matchErr } = await admin
      .from("matches")
      .select("id, result, opponent_archetype, created_at, saved_deck_id")
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(6);

    if (matchErr || !matchRows?.length) return [];

    const deckById = new Map(pubDecks.map((d) => [d.id as string, d]));
    const profileById = new Map(profileRows.map((p) => [p.id as string, p]));

    return matchRows.flatMap((m) => {
      const deck = deckById.get(m.saved_deck_id as string);
      const profile = deck ? profileById.get(deck.user_id as string) : null;
      if (!deck || !profile?.username) return [];
      return [{
        id: m.id as string,
        result: m.result as "win" | "loss" | "draw",
        opponentArchetype: m.opponent_archetype as string | null,
        createdAt: m.created_at as string,
        deckId: deck.id as string,
        deckName: deck.name as string,
        username: profile.username as string,
      }];
    });
  } catch (err) {
    console.error("[home/recent-matches] failed:", err);
    return [];
  }
}

export default async function DeckProfilerPage() {
  const [stats, recentMatches] = await Promise.all([loadStats(), loadRecentMatches()]);
  return <HomeClient stats={stats} recentMatches={recentMatches} />;
}
