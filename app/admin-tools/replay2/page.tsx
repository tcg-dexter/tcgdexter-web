import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Replay2Client, { type ReplayBattleOption } from "./Replay2Client";

export const metadata: Metadata = {
  title: "Replay 2.0 · Admin Tools",
};

export const dynamic = "force-dynamic";

interface BattleRow {
  id: string;
  created_at: string;
  player_handle: string | null;
  opponent_handle: string | null;
  opponent_archetype: string | null;
  result: "win" | "loss" | "draw" | null;
  saved_deck_id: string;
}

interface DeckRow {
  id: string;
  name: string;
}

export default async function Replay2Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  // Five most-recent log-imported battles that actually carry a battle
  // log. The summarize step on import stamps source = 'tcg_live_log', but
  // we still null-check battle_log_raw so a half-imported row never makes
  // it into the picker.
  const { data: battleRows } = await supabase
    .from("matches")
    .select(
      "id, created_at, player_handle, opponent_handle, opponent_archetype, result, saved_deck_id, battle_log_raw",
    )
    .eq("source", "tcg_live_log")
    .not("battle_log_raw", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const battles = (battleRows ?? []) as (BattleRow & { battle_log_raw: string })[];

  const deckIds = Array.from(new Set(battles.map((m) => m.saved_deck_id)));
  const { data: deckRows } = await supabase
    .from("saved_decks")
    .select("id, name")
    .in("id", deckIds.length ? deckIds : ["00000000-0000-0000-0000-000000000000"]);
  const deckById = new Map(((deckRows ?? []) as DeckRow[]).map((d) => [d.id, d]));

  const options: ReplayBattleOption[] = battles.map((m) => ({
    id: m.id,
    createdAt: m.created_at,
    playerHandle: m.player_handle,
    opponentHandle: m.opponent_handle,
    opponentArchetype: m.opponent_archetype,
    result: m.result,
    deckName: deckById.get(m.saved_deck_id)?.name ?? "Untitled deck",
  }));

  return <Replay2Client options={options} />;
}
