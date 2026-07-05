import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserDeckCardProps } from "@/app/components/DeckPostCard";
import { primaryCardImageUrl, deckAvatarInfo, pokemonSlug } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { computeDeckRecords } from "@/lib/deck-record";
import MyDecksClient from "./MyDecksClient";

interface DeckRow {
  id: string;
  short_id: string;
  name: string;
  deck_list: string;
  analysis: {
    deckPrice?: number;
    metaMatch?: { archetypeName?: string | null; archetypeId?: string | null };
    rotation?: { ready?: boolean };
    sections?: { pokemon: number; trainer: number; energy: number };
    cards?: Array<{ qty: number; name: string; number: string; setCode: string; section: "pokemon" | "trainer" | "energy" }>;
  } | null;
  updated_at: string;
  created_at: string;
  like_count: number;
  is_public: boolean;
  is_favorite: boolean;
  cover_image_url: string | null;
}

interface MatchRow {
  saved_deck_id: string | null;
  result: string;
  played_at: string;
}

export const metadata = {
  title: "My Decks — TCG Dexter",
};

export default async function MyDecksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.username) redirect("/settings");

  const { data: decksRaw } = await supabase
    .from("saved_decks")
    .select("id, short_id, name, deck_list, analysis, updated_at, created_at, like_count, is_public, is_favorite, cover_image_url")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const decks = (decksRaw ?? []) as DeckRow[];

  const { data: matchesRaw } = await supabase
    .from("matches")
    .select("saved_deck_id, result, played_at");
  const manualMatches = (matchesRaw ?? []) as MatchRow[];

  const deckRecords = computeDeckRecords(manualMatches);

  const deckCards: UserDeckCardProps[] = decks.map((deck) => {
    const cards = deck.analysis?.cards ?? [];
    const avatar = deckAvatarInfo(cards, deck.cover_image_url);
    const slug = avatar ? pokemonSlug(avatar.name) : "";
    return {
      id: deck.id,
      name: deck.name,
      href: `/u/${profile.username}/${deck.short_id}`,
      username: profile.username,
      displayName: profile.display_name,
      price: deck.analysis?.deckPrice ?? null,
      counts: deck.analysis?.sections ?? null,
      wl: deckRecords.get(deck.id) ?? null,
      likeCount: deck.like_count,
      isPrivate: !deck.is_public,
      isFavorite: deck.is_favorite,
      legalityReady: deck.analysis?.rotation?.ready ?? null,
      archetypeName: deck.analysis?.metaMatch?.archetypeName ?? null,
      archetypeId: deck.analysis?.metaMatch?.archetypeId ?? null,
      updatedAt: deck.updated_at,
      imageUrl: deck.cover_image_url ?? primaryCardImageUrl(cards),
      ownerUserId: user.id,
      createdAt: deck.created_at,
      iconUrl: slug
        ? `https://r2.limitlesstcg.net/pokemon/gen9/${slug}.png`
        : null,
      iconBg: avatar ? typeColor(avatar.types) : null,
      cards,
      coverImageUrl: deck.cover_image_url,
      deckList: deck.deck_list,
      isPublic: deck.is_public,
      canManage: true,
    };
  });

  return <MyDecksClient decks={deckCards} />;
}
