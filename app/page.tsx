import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cardTypesForName, cardTypesForSetIdNumber } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { loadRecentMatches } from "@/lib/recent-matches";
import HomeClient, { type CurrentSpotlight } from "./HomeClient";
import type { TrainerSpotlightRow } from "./spotlight/types";
import { parseDeckListCards } from "@/lib/cardPrinting";
import { resolveDeckTiles, type ResolvedDeckTile } from "@/lib/deckTiles";

// Revalidate the home page (and its stat counts) at most once per minute.
export const revalidate = 60;

const DEXTER_NZV11 = `Pokémon: 12
1 N's Zoroark ex JTG 189
1 N's Zorua PR-SV 189
1 Munkidori TWM 95
1 N's Reshiram ASC 154
2 N's Zekrom ASC 155
2 N's Darmanitan JTG 27
1 Fezandipiti ex ASC 142
1 Meowth ex POR 62
1 Pecharunt ex SFA 39
2 N's Darumaka ASC 32
3 N's Zoroark ex JTG 175
3 N's Zorua ASC 136

Trainer: 16
1 Punk Helmet PFL 92
1 Team Rocket's Petrel DRI 176
1 Xerosic's Machinations SFA 64
4 Buddy-Buddy Poffin MEG 167
2 Poké Pad ASC 198
3 N's PP Up ASC 195
4 Lillie's Determination ASC 192
1 Binding Mochi SFA 55
2 Black Belt's Training PRE 96
1 Hyper Aroma TWM 152
1 Night Stretcher SSP 251
2 N's Castle JTG 152
2 Janine's Secret Art SFA 59
2 Ciphermaniac's Codebreaking PRE 104
4 Ultra Ball MEG 131
2 Boss's Orders MEG 114

Energy: 1
8 Basic {D} Energy MEE 7`;

function loadShowcaseTiles(): ResolvedDeckTile[] {
  try {
    return resolveDeckTiles(parseDeckListCards(DEXTER_NZV11));
  } catch {
    return [];
  }
}

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
  const showcaseTiles = loadShowcaseTiles();
  return (
    <HomeClient
      stats={stats}
      recentMatches={recentMatches}
      currentSpotlight={currentSpotlight}
      showcaseTiles={showcaseTiles}
    />
  );
}
