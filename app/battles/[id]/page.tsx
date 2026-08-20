import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { primaryCardImageUrl, primaryPokemonCard } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { resolveOpponentHero } from "@/lib/opponentHeroCard";
import { stripCardIds } from "@/lib/battle-log";
import { idColumn } from "@/lib/shortId";
import BattleLogPage from "./BattleLogPage";

type AnalysisCard = {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
};

export default async function BattleRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  // The signed-in viewer, if any. The owner can view their own battle even
  // when the deck or profile is still private (e.g. a match they just logged
  // on a deck they haven't shared yet) — everyone else needs both public.
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  // The route param is the match's short_id; UUID-shaped values still
  // resolve so links shared before short_ids existed keep working.
  const { data: match } = await admin
    .from("matches")
    .select(
      "id, short_id, result, opponent_archetype, created_at, played_at, saved_deck_id, source, player_handle, opponent_handle",
    )
    .eq(idColumn(id), id)
    .maybeSingle();

  if (!match) notFound();

  // Child-table lookups below key off the real row id, not the URL param.
  const matchId = match.id as string;

  const { data: deck } = await admin
    .from("saved_decks")
    .select("id, name, user_id, is_public, cover_image_url, analysis")
    .eq("id", match.saved_deck_id as string)
    .maybeSingle();

  if (!deck) notFound();

  const isOwner = !!viewer && viewer.id === (deck.user_id as string);

  if (!isOwner && !(deck.is_public as boolean)) notFound();

  const { data: profile } = await admin
    .from("profiles")
    .select("username, is_public")
    .eq("id", deck.user_id as string)
    .maybeSingle();

  if (!profile || !profile.username) notFound();
  if (!isOwner && !(profile.is_public as boolean)) notFound();

  const analysis = deck.analysis as { cards?: AnalysisCard[] } | null | undefined;
  const coverUrl = deck.cover_image_url as string | null | undefined;
  const analysisCards = analysis?.cards ?? [];
  const playerPrimary = analysisCards.length ? primaryPokemonCard(analysisCards) : null;
  const deckImageUrl: string | null =
    coverUrl ?? (analysisCards.length ? primaryCardImageUrl(analysisCards) : null);
  const playerPokemonName: string | null = playerPrimary?.card.name ?? null;
  const playerColor: string = typeColor(playerPrimary?.types);

  const hasBattleLog = (match.source as string) === "tcg_live_log";

  let opponentAttackerName: string | null = null;
  let opponentImageUrl: string | null = null;
  const stats = {
    player: { damage: 0, pokemon: 0, supporters: 0, items: 0, energy: 0, prizes: 0 },
    opponent: { damage: 0, pokemon: 0, supporters: 0, items: 0, energy: 0, prizes: 0 },
  };

  if (hasBattleLog) {
    const { data: statRows } = await admin
      .from("match_actions")
      .select("actor, action_type, payload")
      .eq("match_id", matchId)
      .in("action_type", [
        "attack",
        "play_to_active",
        "play_to_bench",
        "play_supporter",
        "play_item",
        "attach_energy",
        "prize_taken",
      ]);

    const dmgByAttacker = new Map<string, number>();
    for (const row of statRows ?? []) {
      const side: "player" | "opponent" | null =
        row.actor === "player" ? "player" : row.actor === "opponent" ? "opponent" : null;
      if (!side) continue;
      const bucket = stats[side];
      const payload = row.payload as Record<string, unknown>;
      switch (row.action_type) {
        case "attack": {
          const damage = typeof payload?.damage === "number" ? payload.damage : 0;
          bucket.damage += damage;
          if (side === "opponent") {
            const attacker =
              typeof payload?.attacker === "string"
                ? stripCardIds(payload.attacker).trim()
                : null;
            if (attacker && damage) {
              dmgByAttacker.set(attacker, (dmgByAttacker.get(attacker) ?? 0) + damage);
            }
          }
          break;
        }
        case "play_to_active":
        case "play_to_bench":
          bucket.pokemon += 1;
          break;
        case "play_supporter":
          bucket.supporters += 1;
          break;
        case "play_item":
          bucket.items += 1;
          break;
        case "attach_energy":
          bucket.energy += 1;
          break;
        case "prize_taken":
          bucket.prizes += typeof payload?.count === "number" && payload.count > 0 ? payload.count : 1;
          break;
      }
    }
    let topDmg = 0;
    dmgByAttacker.forEach((dmg, name) => {
      if (dmg > topDmg) { topDmg = dmg; opponentAttackerName = name; }
    });

    // Fallback: if the opponent never attacked (early concede, KO before
    // their attack landed, etc.), pick the highest-rank Pokémon they
    // played or evolved into. Routes through primaryPokemonCard so we
    // get the same stage/qty preference used for deck primary cards.
    if (!opponentAttackerName) {
      const { data: playRows } = await admin
        .from("match_actions")
        .select("action_type, payload")
        .eq("match_id", matchId)
        .eq("actor", "opponent")
        .in("action_type", ["play_to_active", "play_to_bench", "evolve"]);

      const countByName = new Map<string, number>();
      for (const row of playRows ?? []) {
        const payload = row.payload as Record<string, unknown>;
        const rawName =
          row.action_type === "evolve"
            ? (typeof payload?.to === "string" ? payload.to : null)
            : (typeof payload?.card === "string" ? payload.card : null);
        const name = rawName ? stripCardIds(rawName).trim() : null;
        if (name) countByName.set(name, (countByName.get(name) ?? 0) + 1);
      }
      if (countByName.size > 0) {
        const synthetic: AnalysisCard[] = Array.from(countByName.entries()).map(
          ([name, qty]) => ({ name, qty, number: "", setCode: "", section: "pokemon" }),
        );
        const primary = primaryPokemonCard(synthetic);
        if (primary) opponentAttackerName = primary.card.name;
      }
    }
  }

  // A recognized archetype beats gameplay inference — see
  // resolveOpponentHero's own comment for why — and this is the same
  // resolver lib/recent-matches.ts uses for the /battles preview cards, so
  // a battle's banner can never show different art than its own card in
  // that list. opponentAttackerName above is exactly the one gameplay
  // signal this cascade needs: the top-damage attacker, or (when nobody
  // attacked) the opponent's most-played/evolved-into Pokémon.
  const hero = resolveOpponentHero({
    opponentArchetype: match.opponent_archetype as string | null,
    gameplayName: opponentAttackerName,
  });
  if (hero) {
    opponentAttackerName = hero.name;
    opponentImageUrl = hero.imageUrl;
  }
  const opponentColor: string = hero ? hero.color : typeColor(undefined);

  const playerHandle = (match.player_handle as string | null) ?? null;
  const opponentHandle = (match.opponent_handle as string | null) ?? null;
  const playedAt =
    (match.played_at as string | null) ?? (match.created_at as string);

  return (
    <BattleLogPage
      matchId={match.short_id as string}
      result={match.result as "win" | "loss" | "draw"}
      opponentArchetype={match.opponent_archetype as string | null}
      playedAt={playedAt}
      deckName={deck.name as string}
      username={profile.username as string}
      deckImageUrl={deckImageUrl}
      playerPokemonName={playerPokemonName}
      playerColor={playerColor}
      playerHandle={playerHandle}
      opponentAttackerName={opponentAttackerName}
      opponentImageUrl={opponentImageUrl}
      opponentColor={opponentColor}
      opponentHandle={opponentHandle}
      playerStats={stats.player}
      opponentStats={stats.opponent}
      hasBattleLog={hasBattleLog}
    />
  );
}
