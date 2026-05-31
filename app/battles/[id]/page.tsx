import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import {
  primaryCardImageUrl,
  primaryPokemonCard,
  cardImageUrlForName,
  cardTypesForName,
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
    .select("id, result, opponent_archetype, created_at, saved_deck_id, source")
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

  if (hasBattleLog) {
    const { data: attackRows } = await admin
      .from("match_actions")
      .select("payload")
      .eq("match_id", id)
      .eq("action_type", "attack")
      .eq("actor", "opponent");

    const dmgByAttacker = new Map<string, number>();
    for (const row of attackRows ?? []) {
      const payload = row.payload as Record<string, unknown>;
      const attacker = typeof payload?.attacker === "string" ? payload.attacker : null;
      const damage = typeof payload?.damage === "number" ? payload.damage : 0;
      if (attacker && damage) {
        dmgByAttacker.set(attacker, (dmgByAttacker.get(attacker) ?? 0) + damage);
      }
    }
    let topDmg = 0;
    dmgByAttacker.forEach((dmg, name) => {
      if (dmg > topDmg) { topDmg = dmg; opponentAttackerName = name; }
    });
    if (opponentAttackerName) opponentImageUrl = cardImageUrlForName(opponentAttackerName);
  }

  const opponentColor: string = typeColor(
    opponentAttackerName ? cardTypesForName(opponentAttackerName) : undefined,
  );

  return (
    <BattleLogPage
      matchId={id}
      result={match.result as "win" | "loss" | "draw"}
      opponentArchetype={match.opponent_archetype as string | null}
      createdAt={match.created_at as string}
      deckName={deck.name as string}
      username={profile.username as string}
      deckImageUrl={deckImageUrl}
      playerPokemonName={playerPokemonName}
      playerColor={playerColor}
      opponentAttackerName={opponentAttackerName}
      opponentImageUrl={opponentImageUrl}
      opponentColor={opponentColor}
      hasBattleLog={hasBattleLog}
    />
  );
}
