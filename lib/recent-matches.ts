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

export async function loadRecentMatches(limit = 6): Promise<RecentMatch[]> {
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

    // Step 2: most recent matches on those decks. Surface matches with a
    // parsed battle log (source = 'tcg_live_log') — the /battles detail
    // page has a story to tell when there's a log to render — or any match
    // (manual single games via prizes_taken_player/_opponent, or best-of-3
    // sets via game_prizes) where the player recorded prize counts. For the
    // latter, an opponent image can only be shown once we also know a
    // recognized meta archetype (checked below), so over-fetch candidates
    // and trim to `limit` after that filter.
    const { data: matchRows, error: matchErr } = await admin
      .from("matches")
      .select("id, result, opponent_archetype, opponent_handle, created_at, saved_deck_id, source, prizes_taken_player, prizes_taken_opponent, game_prizes, game_results")
      .or(
        "source.eq.tcg_live_log,and(prizes_taken_player.not.is.null,prizes_taken_opponent.not.is.null),game_prizes.not.is.null"
      )
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(Math.min(limit * 4, 400));

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
        .select("match_id, actor, payload")
        .in("match_id", matchIds)
        .eq("action_type", "attack"),
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

    // Aggregate opponent damage per match → top attacker name; and total
    // damage across BOTH sides per match → drives the /matches Featured
    // Match ranking (highest total damage in the last 7 days).
    const opponentDmg = new Map<string, Map<string, number>>();
    const totalDamageByMatch = new Map<string, number>();
    for (const row of attackRows ?? []) {
      const payload = row.payload as Record<string, unknown> | null;
      const damage = typeof payload?.damage === "number" ? payload.damage : 0;
      if (!damage) continue;
      const matchId = row.match_id as string;
      totalDamageByMatch.set(matchId, (totalDamageByMatch.get(matchId) ?? 0) + damage);

      if (row.actor !== "opponent") continue;
      // Strip verbose-export card-id prefixes ("(me1_77) Mega Lucario ex") so
      // the name resolves to a card image and reads cleanly in the preview.
      const attacker =
        typeof payload?.attacker === "string"
          ? stripCardIds(payload.attacker).trim()
          : null;
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
    // Aggregate play_to_active/play_to_bench/evolve counts per match, then
    // route through primaryPokemonCard so stage/qty preference matches the
    // battle page's logic.
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

    const results = matchRows.flatMap((m) => {
      const deck = deckById.get(m.saved_deck_id as string);
      const profile = deck ? profileById.get(deck.user_id as string) : null;
      if (!deck || !profile?.username) return [];

      // Derive deck cover image
      const detail = deckDetailById.get(deck.id as string);
      const coverUrl = detail?.cover_image_url as string | null | undefined;
      const analysis = detail?.analysis as { cards?: AnalysisCard[] } | null | undefined;
      const deckImageUrl: string | null =
        coverUrl ?? (analysis?.cards ? primaryCardImageUrl(analysis.cards) : null);
      const deckCardNames = Array.from(
        new Set((analysis?.cards ?? []).map((c) => c.name)),
      );

      // Accent colors mirror the battle banner: typeColor() of each side's
      // primary Pokémon. Falls back to Colorless when types aren't resolvable.
      const playerPrimary = analysis?.cards ? primaryPokemonCard(analysis.cards) : null;
      const playerColor = typeColor(playerPrimary?.types);

      const topAttacker = topAttackerByMatch.get(m.id as string) ?? null;
      let opponentImageUrl: string | null;
      let opponentColor: string;

      if (m.source === "tcg_live_log") {
        // Derive opponent image from top attacker name (battle log matches)
        opponentImageUrl = topAttacker ? cardImageUrlForName(topAttacker) : null;
        opponentColor = typeColor(
          topAttacker ? cardTypesForName(topAttacker) : undefined,
        );
      } else {
        // Manual / prize-only matches have no battle-log actions to derive an
        // opponent card from, so they additionally require a recognized
        // top-30 meta archetype with a resolvable primary card — anything
        // else, skip the match rather than show a blank opponent slot.
        const archetypeCard = m.opponent_archetype
          ? metaArchetypeCard(m.opponent_archetype as string)
          : null;
        if (!archetypeCard) return [];
        opponentImageUrl = archetypeCard.imageUrl;
        opponentColor = typeColor(archetypeCard.types);
      }

      // Prefer prizes derived from parsed battle-log actions; fall back to
      // the manually-entered totals (single match or summed BO3 games) so
      // manual matches don't show a misleading 0-0.
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
        deckId: deck.id as string,
        deckName: deck.name as string,
        username: profile.username as string,
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

    return results.slice(0, limit);
  } catch (err) {
    console.error("[recent-matches] failed:", err);
    return [];
  }
}
