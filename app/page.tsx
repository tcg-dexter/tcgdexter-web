import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  primaryCardImageUrl,
  cardImageUrlForName,
  primaryPokemonCard,
  cardTypesForName,
  cardTypesForSetIdNumber,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import HomeClient, { type CurrentSpotlight, type RecentMatch } from "./HomeClient";
import type { TrainerSpotlightRow } from "./spotlight/types";

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

    // Step 2: 6 most recent matches on those decks. Surface matches with a
    // parsed battle log (source = 'tcg_live_log') — the /battles detail
    // page has a story to tell when there's a log to render — or any match
    // (manual single games via prizes_taken_player/_opponent, or best-of-3
    // sets via game_prizes) where the player recorded prize counts, which
    // is enough to call the result legitimate without a full log.
    const { data: matchRows, error: matchErr } = await admin
      .from("matches")
      .select("id, result, opponent_archetype, opponent_handle, created_at, saved_deck_id")
      .or(
        "source.eq.tcg_live_log,and(prizes_taken_player.not.is.null,prizes_taken_opponent.not.is.null),game_prizes.not.is.null"
      )
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(6);

    if (matchErr || !matchRows?.length) return [];

    // Step 3: in parallel — fetch deck analysis for cover images, and
    //         fetch opponent attack actions from any imported battle logs
    const matchDeckIds = Array.from(new Set(matchRows.map((m) => m.saved_deck_id as string)));
    const matchIds = matchRows.map((m) => m.id as string);

    const [
      { data: deckDetailRows },
      { data: attackRows },
      { data: playRows },
      { data: prizeRows },
    ] = await Promise.all([
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
      // Prize counts per side per match. Sum payload.count grouped by
      // actor; matches the lib/battle-log/summarize.ts logic so home
      // previews report the same totals as the /battles detail page.
      admin
        .from("match_actions")
        .select("match_id, actor, payload")
        .in("match_id", matchIds)
        .eq("action_type", "prize_taken"),
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
    // Prizes taken per side per match. Each prize_taken row carries a
    // payload.count (1 or 2 — the latter for ex/V/etc. multi-prize KOs).
    const playerPrizesByMatch = new Map<string, number>();
    const opponentPrizesByMatch = new Map<string, number>();
    for (const row of prizeRows ?? []) {
      const payload = row.payload as Record<string, unknown> | null;
      const count =
        typeof payload?.count === "number" && payload.count > 0
          ? payload.count
          : 1;
      const matchId = row.match_id as string;
      const map =
        row.actor === "player" ? playerPrizesByMatch : opponentPrizesByMatch;
      map.set(matchId, (map.get(matchId) ?? 0) + count);
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

      // Accent colors mirror the battle banner: typeColor() of each side's
      // primary Pokémon. Falls back to Colorless when types aren't resolvable.
      const playerPrimary = analysis?.cards ? primaryPokemonCard(analysis.cards) : null;
      const playerColor = typeColor(playerPrimary?.types);
      const opponentColor = typeColor(
        topAttacker ? cardTypesForName(topAttacker) : undefined,
      );

      return [{
        id: m.id as string,
        result: m.result as "win" | "loss" | "draw",
        opponentArchetype: m.opponent_archetype as string | null,
        opponentHandle: (m.opponent_handle as string | null) ?? null,
        createdAt: m.created_at as string,
        deckId: deck.id as string,
        deckName: deck.name as string,
        username: profile.username as string,
        deckImageUrl: deckImageUrl ?? null,
        opponentImageUrl,
        opponentAttackerName: topAttacker,
        playerColor,
        opponentColor,
        playerPrizes: playerPrizesByMatch.get(m.id as string) ?? 0,
        opponentPrizes: opponentPrizesByMatch.get(m.id as string) ?? 0,
      }];
    });
  } catch (err) {
    console.error("[home/recent-matches] failed:", err);
    return [];
  }
}

async function loadCurrentSpotlight(): Promise<CurrentSpotlight | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("trainer_spotlights")
      .select("*")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<TrainerSpotlightRow>();
    if (!data) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.profile_id)
      .maybeSingle<{ username: string }>();
    if (!profile?.username) return null;

    // Mirrors app/spotlight/[slug]/page.tsx — favorite Pokémon, first
    // collection card, first format card drive the three banner accents.
    const firstCollection = data.favorite_collection_cards?.[0] ?? null;
    const firstPlay = data.favorite_format_cards?.[0] ?? null;
    const accentColors: (string | null)[] = [
      data.favorite_pokemon
        ? typeColor(cardTypesForName(data.favorite_pokemon.name))
        : null,
      firstCollection
        ? typeColor(
            cardTypesForSetIdNumber(
              firstCollection.set_id,
              firstCollection.number,
              firstCollection.name,
            ),
          )
        : null,
      firstPlay
        ? typeColor(
            cardTypesForSetIdNumber(
              firstPlay.set_id,
              firstPlay.number,
              firstPlay.name,
            ),
          )
        : null,
    ];

    return {
      id: data.id,
      slug: data.slug,
      username: profile.username,
      layout: data.banner_layout,
      favoritePokemon: data.favorite_pokemon,
      favoriteCollectionCards: data.favorite_collection_cards ?? [],
      favoriteFormatCards: data.favorite_format_cards ?? [],
      userImageUrl: data.avatar_image_url,
      accentColors,
    };
  } catch (err) {
    console.error("[home/current-spotlight] failed:", err);
    return null;
  }
}

export default async function DeckProfilerPage() {
  const [stats, recentMatches, currentSpotlight] = await Promise.all([
    loadStats(),
    loadRecentMatches(),
    loadCurrentSpotlight(),
  ]);
  return (
    <HomeClient
      stats={stats}
      recentMatches={recentMatches}
      currentSpotlight={currentSpotlight}
    />
  );
}
