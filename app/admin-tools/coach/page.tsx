import { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import CoachClient from "./CoachClient";

export const metadata: Metadata = {
  title: "Coach Dexter · Admin Tools",
};

export const dynamic = "force-dynamic";

const LOG_LIMIT = 50;

/** One row in the log picker. Deliberately carries no deck text and no raw
 *  log — `battle_log_raw` is large and is fetched only by the analysis route,
 *  for the one id the admin picks. */
export interface CoachLogOption {
  id: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  result: string | null;
  playedAt: string | null;
  totalTurns: number | null;
  opponentArchetype: string | null;
  /** Without a linked deck the reconstructed deck is weaker and coverage
   *  drops, so the picker marks these rows. */
  hasDeckList: boolean;
}

interface MatchRow {
  id: string;
  player_handle: string | null;
  opponent_handle: string | null;
  result: string | null;
  played_at: string | null;
  total_turns: number | null;
  opponent_archetype: string | null;
  saved_deck_id: string | null;
}

export default async function CoachDexterPage() {
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

  // Service-role read: this instrument exists to judge the coach against a
  // real corpus, which means every imported log, not just this admin's own.
  // `matches` is RLS-scoped to its owner, so the user client cannot see them.
  const admin = createAdminClient();
  const { data: matchRows } = await admin
    .from("matches")
    .select(
      "id, player_handle, opponent_handle, result, played_at, total_turns, opponent_archetype, saved_deck_id",
    )
    .not("battle_log_raw", "is", null)
    .not("player_handle", "is", null)
    .order("played_at", { ascending: false })
    .limit(LOG_LIMIT);

  const matches = (matchRows ?? []) as MatchRow[];

  // Which of those decks actually carry a list. Selecting `id` alone keeps the
  // deck text off this page entirely — the picker only needs a boolean.
  const deckIds = Array.from(
    new Set(matches.map((m) => m.saved_deck_id).filter((id): id is string => !!id)),
  );
  const { data: deckRows } = await admin
    .from("saved_decks")
    .select("id")
    .not("deck_list", "is", null)
    .in("id", deckIds.length ? deckIds : ["00000000-0000-0000-0000-000000000000"]);
  const withDeck = new Set((deckRows ?? []).map((d) => (d as { id: string }).id));

  const logs: CoachLogOption[] = matches.map((m) => ({
    id: m.id,
    playerHandle: m.player_handle,
    opponentHandle: m.opponent_handle,
    result: m.result,
    playedAt: m.played_at,
    totalTurns: m.total_turns,
    opponentArchetype: m.opponent_archetype,
    hasDeckList: !!m.saved_deck_id && withDeck.has(m.saved_deck_id),
  }));

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Coach Dexter</h1>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Pick an imported battle log and grade it decision by decision. For every
            decision the engine can reconstruct, it values each legal move by rolling it
            forward, then reports what the move actually played gave up — and the plays a
            competent bot would have missed.
          </p>
        </header>

        <CoachClient logs={logs} />
      </div>
    </main>
  );
}
