import { createAdminClient } from "@/lib/supabase/admin";
import {
  primaryCardImageUrl,
  cardImageUrlForName,
  primaryPokemonCard,
} from "@/lib/primaryCardImage";
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

type AnalysisCard = {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
};

async function loadRecentMatches(): Promise<RecentMatch[]> {
  try {
    const admin = createAdminClient();

    // Step 1: public saved_decks where the owner's profile is also public
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

    // Step 2: 6 most recent matches on those decks. Restrict to matches
    // with a parsed battle log (source = 'tcg_live_log') — the /battles
    // detail page only has a story to tell when there's a log to render,
    // so non-log matches aren't promote-worthy on the home feed.
    const { data: matchRows, error: matchErr } = await admin
      .from("matches")
      .select("id, result, opponent_archetype, created_at, saved_deck_id")
      .eq("source", "tcg_live_log")
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(6);

    if (matchErr || !matchRows?.length) return [];

    // Step 3: in parallel — fetch deck analysis for cover images, and
    //         fetch opponent attack actions from any imported battle logs
    const matchDeckIds = Array.from(new Set(matchRows.map((m) => m.saved_deck_id as string)));
    const matchIds = matchRows.map((m) => m.id as string);

    const [{ data: deckDetailRows }, { data: attackRows }, { data: playRows }] =
      await Promise.all([
        admin
          .from("saved_decks")
          .select("id, cover_image_url, analysis")
          .in("id", matchDeckIds),
        admin
          .from("match_actions")
          .select("match_id, payload")
          .in("match_id", matchIds)
          .eq("action_type", "attack")
          .eq("actor", "opponent"),
        // Fallback inputs: opponent's played/evolved Pokémon. Used when
        // the opponent never attacked (concede, KO'd before swinging),
        // mirroring the /battles/[id] page's opponent-card resolution
        // so home-page previews and the battle banner stay in sync.
        admin
          .from("match_actions")
          .select("match_id, action_type, payload")
          .in("match_id", matchIds)
          .eq("actor", "opponent")
          .in("action_type", ["play_to_active", "play_to_bench", "evolve"]),
      ]);

    // Build lookups
    const deckById = new Map(pubDecks.map((d) => [d.id as string, d]));
    const profileById = new Map(profileRows.map((p) => [p.id as string, p]));
    const deckDetailById = new Map(
      (deckDetailRows ?? []).map((d) => [d.id as string, d])
    );

    // Aggregate opponent damage per match → top attacker name
    const opponentDmg = new Map<string, Map<string, number>>();
    for (const row of attackRows ?? []) {
      const payload = row.payload as Record<string, unknown> | null;
      const attacker = typeof payload?.attacker === "string" ? payload.attacker : null;
      const damage = typeof payload?.damage === "number" ? payload.damage : 0;
      if (!attacker || !damage) continue;
      const matchId = row.match_id as string;
      if (!opponentDmg.has(matchId)) opponentDmg.set(matchId, new Map());
      const m = opponentDmg.get(matchId)!;
      m.set(attacker, (m.get(attacker) ?? 0) + damage);
    }

    const topAttackerByMatch = new Map<string, string>();
    opponentDmg.forEach((attackerMap, matchId) => {
      let topName = "";
      let topDmg = 0;
      attackerMap.forEach((dmg, name) => {
        if (dmg > topDmg) { topDmg = dmg; topName = name; }
      });
      if (topName) topAttackerByMatch.set(matchId, topName);
    });

    // Fallback per match: highest-rank Pokémon the opponent put into play.
    // Aggregate play_to_active/play_to_bench/evolve counts per match, then
    // route through primaryPokemonCard so stage/qty preference matches the
    // battle page's logic.
    const opponentPlaysByMatch = new Map<string, Map<string, number>>();
    for (const row of playRows ?? []) {
      const payload = row.payload as Record<string, unknown> | null;
      const name =
        row.action_type === "evolve"
          ? (typeof payload?.to === "string" ? payload.to : null)
          : (typeof payload?.card === "string" ? payload.card : null);
      if (!name) continue;
      const matchId = row.match_id as string;
      if (!opponentPlaysByMatch.has(matchId)) opponentPlaysByMatch.set(matchId, new Map());
      const m = opponentPlaysByMatch.get(matchId)!;
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    opponentPlaysByMatch.forEach((countByName, matchId) => {
      if (topAttackerByMatch.has(matchId)) return;
      const synthetic: AnalysisCard[] = Array.from(countByName.entries()).map(
        ([name, qty]) => ({ name, qty, number: "", setCode: "", section: "pokemon" }),
      );
      const primary = primaryPokemonCard(synthetic);
      if (primary) topAttackerByMatch.set(matchId, primary.card.name);
    });

    return matchRows.flatMap((m) => {
      const deck = deckById.get(m.saved_deck_id as string);
      const profile = deck ? profileById.get(deck.user_id as string) : null;
      if (!deck || !profile?.username) return [];

      // Derive deck cover image
      const detail = deckDetailById.get(deck.id as string);
      const coverUrl = detail?.cover_image_url as string | null | undefined;
      const analysis = detail?.analysis as { cards?: AnalysisCard[] } | null | undefined;
      const deckImageUrl: string | null =
        coverUrl ?? (analysis?.cards ? primaryCardImageUrl(analysis.cards) : null);

      // Derive opponent image from top attacker name (battle log matches only)
      const topAttacker = topAttackerByMatch.get(m.id as string) ?? null;
      const opponentImageUrl = topAttacker ? cardImageUrlForName(topAttacker) : null;

      return [{
        id: m.id as string,
        result: m.result as "win" | "loss" | "draw",
        opponentArchetype: m.opponent_archetype as string | null,
        createdAt: m.created_at as string,
        deckId: deck.id as string,
        deckName: deck.name as string,
        username: profile.username as string,
        deckImageUrl: deckImageUrl ?? null,
        opponentImageUrl,
        opponentAttackerName: topAttacker,
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
