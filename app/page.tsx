import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cardTypesForName, cardTypesForSetIdNumber } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { loadRecentMatches } from "@/lib/recent-matches";
import HomeClient, { type CurrentSpotlight } from "./HomeClient";
import type { TrainerSpotlightRow } from "./spotlight/types";

// Revalidate the home page (and its stat counts) at most once per minute.
export const revalidate = 60;

async function loadStats(): Promise<Array<{ label: string; value: string }>> {
  const format = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-US");

  try {
    const admin = createAdminClient();
    const [decksRes, matchesRes] = await Promise.all([
      admin
        .from("analysis_submissions")
        .select("id", { count: "exact", head: true }),
      admin.from("matches").select("id", { count: "exact", head: true }),
    ]);

    if (decksRes.error) {
      console.error("[home/stats] analysis_submissions count failed:", decksRes.error);
    }
    if (matchesRes.error) {
      console.error("[home/stats] matches count failed:", matchesRes.error);
    }

    return [
      { label: "Decks profiled", value: format(decksRes.error ? null : decksRes.count) },
      { label: "Matches logged", value: format(matchesRes.error ? null : matchesRes.count) },
    ];
  } catch (err) {
    console.error("[home/stats] admin client unavailable:", err);
    return [
      { label: "Decks profiled", value: "—" },
      { label: "Matches logged", value: "—" },
    ];
  }
}

async function loadCurrentSpotlight(): Promise<CurrentSpotlight | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("trainer_spotlights")
      .select("*")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle<TrainerSpotlightRow>();
    if (!data) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", data.profile_id)
      .maybeSingle<{ username: string }>();
    if (!profile?.username) return null;

    // Mirrors app/spotlight/[slug]/page.tsx — favorite Pokémon, first
    // collection card, first format card drive the three banner accents.
    const firstCollection = data.favorite_collection_cards?.[0] ?? null;
    const firstPlay = data.favorite_format_cards?.[0] ?? null;
    const accentColors: (string | null)[] = [
      data.favorite_pokemon
        ? typeColor(cardTypesForName(data.favorite_pokemon.name))
        : null,
      firstCollection
        ? typeColor(
            cardTypesForSetIdNumber(
              firstCollection.set_id,
              firstCollection.number,
              firstCollection.name,
            ),
          )
        : null,
      firstPlay
        ? typeColor(
            cardTypesForSetIdNumber(
              firstPlay.set_id,
              firstPlay.number,
              firstPlay.name,
            ),
          )
        : null,
    ];

    return {
      id: data.id,
      slug: data.slug,
      username: profile.username,
      layout: data.banner_layout,
      favoritePokemon: data.favorite_pokemon,
      favoriteCollectionCards: data.favorite_collection_cards ?? [],
      favoriteFormatCards: data.favorite_format_cards ?? [],
      userImageUrl: data.avatar_image_url,
      accentColors,
    };
  } catch (err) {
    console.error("[home/current-spotlight] failed:", err);
    return null;
  }
}

export default async function DeckProfilerPage() {
  const [stats, recentMatches, currentSpotlight] = await Promise.all([
    loadStats(),
    loadRecentMatches(6),
    loadCurrentSpotlight(),
  ]);
  return (
    <HomeClient
      stats={stats}
      recentMatches={recentMatches}
      currentSpotlight={currentSpotlight}
    />
  );
}
