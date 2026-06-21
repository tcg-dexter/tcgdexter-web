import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import {
  primaryCardImageUrl,
  primaryPokemonCard,
  cardImageUrlForName,
  cardTypesForName,
  highestEvolutionForName,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
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

  const { data: match } = await admin
    .from("matches")
    .select(
      "id, result, opponent_archetype, created_at, played_at, saved_deck_id, source, total_turns, player_handle, opponent_handle",
    )
    .eq("id", id)
    .maybeSingle();

  if (!match) notFound();

  const { data: deck } = await admin
    .from("saved_decks")
    .select("id, name, user_id, is_public, cover_image_url, analysis")
    .eq("id", match.saved_deck_id as string)
    .maybeSingle();

  if (!deck || !(deck.is_public as boolean)) notFound();

  const { data: profile } = await admin
    .from("profiles")
    .select("username, is_public")
    .eq("id", deck.user_id as string)
    .maybeSingle();

  if (!profile || !(profile.is_public as boolean) || !profile.username) notFound();

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
      .eq("match_id", id)
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
            const attacker = typeof payload?.attacker === "string" ? payload.attacker : null;
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
          bucket.prizes += 1;
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
        .eq("match_id", id)
        .eq("actor", "opponent")
        .in("action_type", ["play_to_active", "play_to_bench", "evolve"]);

      const countByName = new Map<string, number>();
      for (const row of playRows ?? []) {
        const payload = row.payload as Record<string, unknown>;
        const name =
          row.action_type === "evolve"
            ? (typeof payload?.to === "string" ? payload.to : null)
            : (typeof payload?.card === "string" ? payload.card : null);
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

    // Escalate to the line's headline Pokémon — battle-log inference
    // lands on whatever attacker dealt the most damage, but the deck is
    // usually built around the highest evolution of that line (e.g.
    // Kadabra → Alakazam ex). cardImageUrlForName + cardTypesForName
    // also escalate internally, but doing it here too keeps the name we
    // pass downstream (banner header, social card) in sync.
    if (opponentAttackerName) {
      opponentAttackerName = highestEvolutionForName(opponentAttackerName);
      opponentImageUrl = cardImageUrlForName(opponentAttackerName);
    }
  }

  const opponentColor: string = typeColor(
    opponentAttackerName ? cardTypesForName(opponentAttackerName) : undefined,
  );

  const playerHandle = (match.player_handle as string | null) ?? null;
  const opponentHandle = (match.opponent_handle as string | null) ?? null;
  const playedAt =
    (match.played_at as string | null) ?? (match.created_at as string);
  const totalTurns = (match.total_turns as number | null) ?? null;
  const winnerName =
    match.result === "win"
      ? playerHandle ?? (profile.username as string)
      : match.result === "loss"
      ? opponentHandle ?? (match.opponent_archetype as string | null) ?? "Opponent"
      : null;
  const loserName =
    match.result === "win"
      ? opponentHandle ?? (match.opponent_archetype as string | null) ?? "Opponent"
      : match.result === "loss"
      ? playerHandle ?? (profile.username as string)
      : null;

  return (
    <BattleLogPage
      matchId={id}
      result={match.result as "win" | "loss" | "draw"}
      opponentArchetype={match.opponent_archetype as string | null}
      createdAt={match.created_at as string}
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
      winnerName={winnerName}
      loserName={loserName}
      totalTurns={totalTurns}
      playerStats={stats.player}
      opponentStats={stats.opponent}
      hasBattleLog={hasBattleLog}
    />
  );
}
