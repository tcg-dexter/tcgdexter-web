import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  primaryCardImageUrl,
  cardImageUrlForName,
  primaryPokemonCard,
  cardTypesForName,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { metaArchetypeCard } from "@/lib/metaArchetypeCards";
import { manualPrizeTotals } from "@/lib/bo3";
import { stripCardIds } from "@/lib/battle-log";
import type { RecentMatch } from "@/app/components/MatchCard";

type AnalysisCard = {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
};

interface DeckRef {
  id: string;
  name: string;
  user_id: string;
}

interface ProfileRef {
  id: string;
  username: string;
}

const MATCH_ROW_SELECT =
  "id, result, opponent_archetype, opponent_handle, created_at, saved_deck_id, source, prizes_taken_player, prizes_taken_opponent, game_prizes, game_results";

/**
 * Builds RecentMatch cards from a set of match rows + the decks/profiles
 * they belong to. Shared by the public matches feed (`loadRecentMatches`,
 * cross-user, admin client, curated) and the profile page's private
 * Recent Battles preview (`loadOwnerRecentMatches`, single user, RLS'd
 * client, uncurated) — the image-resolution and prize-aggregation logic
 * is identical either way, only the input scope and `dropIfNoOpponentArt`
 * differ.
 */
async function assembleRecentMatches(
  sb: SupabaseClient,
  matchRows: Record<string, unknown>[],
  deckById: Map<string, DeckRef>,
  profileById: Map<string, ProfileRef>,
  { dropIfNoOpponentArt }: { dropIfNoOpponentArt: boolean },
): Promise<RecentMatch[]> {
  if (!matchRows.length) return [];

  const matchDeckIds = Array.from(new Set(matchRows.map((m) => m.saved_deck_id as string)));
  const matchIds = matchRows.map((m) => m.id as string);

  const [
    { data: deckDetailRows },
    { data: attackRows },
    { data: playRows },
    { data: prizeRows },
  ] = await Promise.all([
    sb.from("saved_decks").select("id, cover_image_url, analysis").in("id", matchDeckIds),
    sb
      .from("match_actions")
      .select("match_id, actor, payload")
      .in("match_id", matchIds)
      .eq("action_type", "attack"),
    // Fallback inputs: opponent's played/evolved Pokémon. Used when the
    // opponent never attacked (concede, KO'd before swinging), mirroring
    // the /battles/[id] page's opponent-card resolution.
    sb
      .from("match_actions")
      .select("match_id, action_type, payload")
      .in("match_id", matchIds)
      .eq("actor", "opponent")
      .in("action_type", ["play_to_active", "play_to_bench", "evolve"]),
    // Prize counts per side per match, summed from prize_taken actions.
    sb
      .from("match_actions")
      .select("match_id, actor, payload")
      .in("match_id", matchIds)
      .eq("action_type", "prize_taken"),
  ]);

  const deckDetailById = new Map((deckDetailRows ?? []).map((d) => [d.id as string, d]));

  // Aggregate opponent damage per match → top attacker name, and total
  // damage across both sides per match (drives the /matches Featured
  // Match ranking).
  const opponentDmg = new Map<string, Map<string, number>>();
  const totalDamageByMatch = new Map<string, number>();
  for (const row of attackRows ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const damage = typeof payload?.damage === "number" ? payload.damage : 0;
    if (!damage) continue;
    const matchId = row.match_id as string;
    totalDamageByMatch.set(matchId, (totalDamageByMatch.get(matchId) ?? 0) + damage);

    if (row.actor !== "opponent") continue;
    const attacker =
      typeof payload?.attacker === "string" ? stripCardIds(payload.attacker).trim() : null;
    if (!attacker) continue;
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
  const opponentPlaysByMatch = new Map<string, Map<string, number>>();
  for (const row of playRows ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const rawName =
      row.action_type === "evolve"
        ? (typeof payload?.to === "string" ? payload.to : null)
        : (typeof payload?.card === "string" ? payload.card : null);
    const name = rawName ? stripCardIds(rawName).trim() : null;
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

  // Prizes taken per side per match.
  const playerPrizesByMatch = new Map<string, number>();
  const opponentPrizesByMatch = new Map<string, number>();
  for (const row of prizeRows ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const count =
      typeof payload?.count === "number" && payload.count > 0 ? payload.count : 1;
    const matchId = row.match_id as string;
    const map = row.actor === "player" ? playerPrizesByMatch : opponentPrizesByMatch;
    map.set(matchId, (map.get(matchId) ?? 0) + count);
  }

  return matchRows.flatMap((m) => {
    const deck = deckById.get(m.saved_deck_id as string);
    const profile = deck ? profileById.get(deck.user_id) : null;
    if (!deck || !profile?.username) return [];

    const detail = deckDetailById.get(deck.id);
    const coverUrl = detail?.cover_image_url as string | null | undefined;
    const analysis = detail?.analysis as { cards?: AnalysisCard[] } | null | undefined;
    const deckImageUrl: string | null =
      coverUrl ?? (analysis?.cards ? primaryCardImageUrl(analysis.cards) : null);
    const deckCardNames = Array.from(new Set((analysis?.cards ?? []).map((c) => c.name)));

    const playerPrimary = analysis?.cards ? primaryPokemonCard(analysis.cards) : null;
    const playerColor = typeColor(playerPrimary?.types);

    const topAttacker = topAttackerByMatch.get(m.id as string) ?? null;
    let opponentImageUrl: string | null;
    let opponentColor: string;

    if (m.source === "tcg_live_log") {
      opponentImageUrl = topAttacker ? cardImageUrlForName(topAttacker) : null;
      opponentColor = typeColor(topAttacker ? cardTypesForName(topAttacker) : undefined);
    } else {
      const archetypeCard = m.opponent_archetype
        ? metaArchetypeCard(m.opponent_archetype as string)
        : null;
      if (!archetypeCard) {
        if (dropIfNoOpponentArt) return [];
        opponentImageUrl = null;
        opponentColor = typeColor(undefined);
      } else {
        opponentImageUrl = archetypeCard.imageUrl;
        opponentColor = typeColor(archetypeCard.types);
      }
    }

    const manualPrizes = manualPrizeTotals({
      prizes_taken_player: m.prizes_taken_player as number | null,
      prizes_taken_opponent: m.prizes_taken_opponent as number | null,
      game_prizes: m.game_prizes as { p: number | null; o: number | null }[] | null,
    });

    return [{
      id: m.id as string,
      result: m.result as "win" | "loss" | "draw",
      opponentArchetype: m.opponent_archetype as string | null,
      opponentHandle: (m.opponent_handle as string | null) ?? null,
      createdAt: m.created_at as string,
      deckId: deck.id,
      deckName: deck.name,
      username: profile.username,
      deckImageUrl: deckImageUrl ?? null,
      deckCardNames,
      opponentImageUrl,
      opponentAttackerName: topAttacker,
      playerColor,
      opponentColor,
      playerPrizes: playerPrizesByMatch.get(m.id as string) ?? manualPrizes?.player ?? 0,
      opponentPrizes: opponentPrizesByMatch.get(m.id as string) ?? manualPrizes?.opponent ?? 0,
      isBestOf3: typeof m.game_results === "string" && m.game_results.length >= 2,
      hasBattleLog: m.source === "tcg_live_log",
      totalDamage: totalDamageByMatch.get(m.id as string) ?? null,
    }];
  });
}

/**
 * Cross-user public matches feed — powers the /matches page. Only matches
 * on public decks owned by public profiles, and only matches with either
 * a parsed battle log or a recognized opponent archetype/prize data (kept
 * visually rich for anonymous browsing; see assembleRecentMatches).
 */
export async function loadRecentMatches(limit = 6): Promise<RecentMatch[]> {
  try {
    const admin = createAdminClient();

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
    const pubDecks = deckRows.filter((d) => pubProfileIds.has(d.user_id as string)) as DeckRef[];
    if (!pubDecks.length) return [];

    const { data: matchRows, error: matchErr } = await admin
      .from("matches")
      .select(MATCH_ROW_SELECT)
      .or(
        "source.eq.tcg_live_log,and(prizes_taken_player.not.is.null,prizes_taken_opponent.not.is.null),game_prizes.not.is.null"
      )
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(Math.min(limit * 4, 400));
    if (matchErr || !matchRows?.length) return [];

    const deckById = new Map(pubDecks.map((d) => [d.id, d]));
    const profileById = new Map(
      (profileRows as ProfileRef[]).map((p) => [p.id, p]),
    );

    const results = await assembleRecentMatches(admin, matchRows, deckById, profileById, {
      dropIfNoOpponentArt: true,
    });
    return results.slice(0, limit);
  } catch (err) {
    console.error("[recent-matches] failed:", err);
    return [];
  }
}

/**
 * A single owner's own recent matches (private — not scoped to public
 * decks/profiles). Powers the profile page's Recent Battles preview.
 * Every logged match is included regardless of whether a nice opponent
 * image can be resolved (MatchCard degrades to a simple layout when an
 * image is missing) — unlike the public feed, this list shouldn't hide
 * a user's own real matches just because the opponent's archetype isn't
 * a recognized meta deck.
 */
export async function loadOwnerRecentMatches(
  sb: SupabaseClient,
  userId: string,
  username: string,
  limit = 3,
): Promise<RecentMatch[]> {
  try {
    const { data: deckRows, error: deckErr } = await sb
      .from("saved_decks")
      .select("id, name, user_id")
      .eq("user_id", userId);
    if (deckErr || !deckRows?.length) return [];

    const decks = deckRows as DeckRef[];
    const { data: matchRows, error: matchErr } = await sb
      .from("matches")
      .select(MATCH_ROW_SELECT)
      .in("saved_deck_id", decks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(limit);
    if (matchErr || !matchRows?.length) return [];

    const deckById = new Map(decks.map((d) => [d.id, d]));
    const profileById = new Map([[userId, { id: userId, username }]]);

    const results = await assembleRecentMatches(sb, matchRows, deckById, profileById, {
      dropIfNoOpponentArt: false,
    });
    return results.slice(0, limit);
  } catch (err) {
    console.error("[recent-matches] owner load failed:", err);
    return [];
  }
}
