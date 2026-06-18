import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { primaryCardImageUrl } from "@/lib/primaryCardImage";
import DeckMatClient, { type DeckSummary } from "./DeckMatClient";
import MobilePageTitle from "@/app/components/ui/MobilePageTitle";

export const metadata: Metadata = {
  title: "Playmat Studio · Admin Tools",
};

interface DeckRow {
  id: string;
  name: string;
  deck_list: string;
  analysis: {
    cards?: Array<{
      qty: number;
      name: string;
      number: string;
      setCode: string;
      section: "pokemon" | "trainer" | "energy";
    }>;
  } | null;
  cover_image_url: string | null;
}

interface MatchRow {
  saved_deck_id: string | null;
  result: string;
}

export default async function DeckMatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  const { data: decksRaw } = await supabase
    .from("saved_decks")
    .select("id, name, deck_list, analysis, cover_image_url")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const decks = (decksRaw ?? []) as DeckRow[];

  const { data: matchesRaw } = await supabase
    .from("matches")
    .select("saved_deck_id, result");
  const matches = (matchesRaw ?? []) as MatchRow[];

  const deckWL = new Map<string, { w: number; l: number; d: number }>();
  for (const m of matches) {
    if (!m.saved_deck_id) continue;
    const prev = deckWL.get(m.saved_deck_id) ?? { w: 0, l: 0, d: 0 };
    if (m.result === "win") prev.w++;
    else if (m.result === "loss") prev.l++;
    else if (m.result === "draw") prev.d++;
    deckWL.set(m.saved_deck_id, prev);
  }

  const deckSummaries: DeckSummary[] = decks.map((deck) => {
    const cards = deck.analysis?.cards ?? [];
    const avatarUrl = deck.cover_image_url ?? primaryCardImageUrl(cards);
    const wl = deckWL.get(deck.id) ?? { w: 0, l: 0, d: 0 };
    return {
      id: deck.id,
      name: deck.name,
      deckList: deck.deck_list,
      avatarUrl,
      wins: wl.w,
      losses: wl.l,
      draws: wl.d,
    };
  });

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <MobilePageTitle href="/admin-tools" title="Playmat Studio" hideBack />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 xl:pt-8">
        <header className="mb-6 hidden xl:block">
          <h1 className="text-2xl font-bold text-text-primary">Playmat Studio</h1>
        </header>

        <DeckMatClient decks={deckSummaries} />
      </div>
    </main>
  );
}
