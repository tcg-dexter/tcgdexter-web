import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import metaDecksData from "@/data/meta-decks.json";
import PlayClient from "./PlayClient";

export const metadata: Metadata = {
  title: "AI Player · Admin Tools",
};

export const dynamic = "force-dynamic";

export interface DeckOption {
  id: string;
  name: string;
  deckList: string;
  archetype: string | null;
  source: "saved" | "meta";
}

interface MetaDeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy" | string;
}

interface MetaDeck {
  id: string;
  name: string;
  cards: MetaDeckCard[];
}

/** Rebuild deck-list text from a meta deck's structured card list, in the
 *  sectioned format parseDeckListCards expects. */
function metaDeckToList(deck: MetaDeck): string {
  const sections: Record<string, MetaDeckCard[]> = { pokemon: [], trainer: [], energy: [] };
  for (const card of deck.cards) {
    (sections[card.category] ?? sections.trainer).push(card);
  }
  const lines: string[] = [];
  const titles: Record<string, string> = { pokemon: "Pokémon", trainer: "Trainer", energy: "Energy" };
  for (const key of ["pokemon", "trainer", "energy"]) {
    const cards = sections[key];
    if (cards.length === 0) continue;
    lines.push(`${titles[key]}: ${cards.reduce((s, c) => s + c.qty, 0)}`);
    for (const c of cards) lines.push(`${c.qty} ${c.name} ${c.setCode} ${c.number}`);
  }
  return lines.join("\n");
}

export default async function PlayPage() {
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

  // The human plays their own decks (user client → RLS-scoped).
  const { data: savedRows } = await supabase
    .from("saved_decks")
    .select("id, name, deck_list, archetype_name")
    .not("deck_list", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  const saved: DeckOption[] = (savedRows ?? []).map((d) => ({
    id: `saved:${d.id}`,
    name: d.name as string,
    deckList: d.deck_list as string,
    archetype: (d.archetype_name as string | null) ?? null,
    source: "saved" as const,
  }));

  const meta: DeckOption[] = (metaDecksData as unknown as MetaDeck[]).map((d) => ({
    id: `meta:${d.id}`,
    name: d.name,
    deckList: metaDeckToList(d),
    archetype: d.name,
    source: "meta" as const,
  }));

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">AI Player</h1>
          <p className="text-sm text-text-secondary mt-1">
            Practice against the engine — pick decks, set the difficulty, and
            get a coach review when the game ends.
          </p>
        </header>
        <PlayClient decks={[...saved, ...meta]} />
      </div>
    </main>
  );
}
