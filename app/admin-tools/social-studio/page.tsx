import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import cardDataRaw from "@/data/cards-standard.json";
import { cardImageLarge } from "@/lib/cardImages";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";
import {
  cardImageUrlForName,
  cardTypesForName,
  cardTypesForSetIdNumber,
  primaryPokemonCard,
} from "@/lib/primaryCardImage";
import type { TrainerSpotlightRow } from "@/app/spotlight/types";
import SocialStudioClient from "./SocialStudioClient";
import type {
  CardSpotlightSubject,
  FeaturedDeckSubject,
  FeaturedMatchSubject,
  MetaArchetypeSubject,
  SpotlightSubject,
} from "./templates/types";

export const metadata: Metadata = {
  title: "Social Studio · Admin Tools",
};

interface SpotlightRow extends TrainerSpotlightRow {
  profiles: {
    display_name: string;
    username: string;
    avatar_url: string | null;
  } | null;
}

interface Archetype {
  id: string;
  name: string;
  total_entries: number;
  representation_pct: number;
  image_url?: string;
  icons?: string;
}

interface MetaDeck {
  id: string;
  cards: Array<{
    qty: number;
    name: string;
    setCode: string;
    number: string;
    category: "pokemon" | "trainer" | "energy";
  }>;
  variants?: { cards: MetaDeck["cards"] }[];
}

interface DeckRow {
  id: string;
  name: string;
  cover_image_url: string | null;
  like_count: number;
  user_id: string;
  analysis: {
    deckPrice?: number;
    cards?: Array<{
      qty: number;
      name: string;
      number: string;
      setCode: string;
      section: "pokemon" | "trainer" | "energy";
    }>;
  } | null;
}

interface CatalogEntry {
  name?: string;
  set_id: string;
  set_name?: string;
  number: string;
  supertype?: string;
  types?: string[];
  rarity?: string;
  artist?: string | null;
  market_price?: number | null;
}

interface MatchRow {
  id: string;
  result: "win" | "loss" | "tie";
  opponent_archetype: string | null;
  opponent_handle: string | null;
  player_handle: string | null;
  saved_deck_id: string;
}

export default async function SocialStudioPage() {
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

  // ── Spotlights ────────────────────────────────────────────────
  const { data: spotlightData } = await supabase
    .from("trainer_spotlights")
    .select(
      "*, profiles!trainer_spotlights_profile_id_fkey(display_name, username, avatar_url)",
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(10);

  const spotlights: SpotlightSubject[] = ((spotlightData ?? []) as SpotlightRow[])
    .filter((s) => s.profiles)
    .map((s) => {
      const firstCollection = s.favorite_collection_cards?.[0] ?? null;
      const firstPlay = s.favorite_format_cards?.[0] ?? null;
      const accentColors = [
        s.favorite_pokemon ? typeColor(cardTypesForName(s.favorite_pokemon.name)) : null,
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
      ].filter((c): c is string => !!c);
      return {
        kind: "spotlight",
        id: s.id,
        slug: s.slug,
        displayName: s.profiles!.display_name,
        username: s.profiles!.username,
        avatarUrl: s.profiles!.avatar_url,
        headline: s.headline,
        accentColors,
        pokemonName: s.favorite_pokemon?.name ?? null,
      };
    });

  // ── Meta archetypes ───────────────────────────────────────────
  const archetypes = (archetypesRaw as Archetype[])
    .sort((a, b) => b.total_entries - a.total_entries)
    .slice(0, 10);
  const metaDecks = metaDecksRaw as MetaDeck[];
  const metaArchetypes: MetaArchetypeSubject[] = archetypes.map((arch) => {
    const deckData = metaDecks.find((d) => d.id === arch.id);
    const cards = deckData?.variants?.[0]?.cards ?? deckData?.cards ?? [];
    let iconList: string[] = [];
    try {
      iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
    } catch {
      iconList = [];
    }
    const primary = metaPrimaryCard(cards, iconList);
    return {
      kind: "meta_archetype",
      id: arch.id,
      name: arch.name,
      representationPct: arch.representation_pct,
      totalEntries: arch.total_entries,
      iconUrl: iconList[0]
        ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
        : null,
      imageUrl: primary?.imageUrl ?? arch.image_url ?? null,
      accentColor: typeColor(primary?.types),
    };
  });

  // ── Card spotlights ───────────────────────────────────────────
  // Chase cards: the priciest Standard-legal Pokémon printings, one per
  // Pokémon name, ranked by market price from the local catalog.
  const cardCatalog = cardDataRaw as unknown as Record<string, CatalogEntry[]>;
  const seenCardNames = new Set<string>();
  const cardSpotlights: CardSpotlightSubject[] = Object.entries(cardCatalog)
    .flatMap(([name, entries]) =>
      entries.map((e) => ({ ...e, name: e.name ?? name })),
    )
    .filter(
      (e): e is CatalogEntry & { name: string; market_price: number } =>
        e.supertype === "Pokémon" &&
        !!e.set_id &&
        typeof e.market_price === "number" &&
        e.market_price > 0,
    )
    .sort((a, b) => b.market_price - a.market_price)
    .filter((e) => {
      if (seenCardNames.has(e.name)) return false;
      seenCardNames.add(e.name);
      return true;
    })
    .slice(0, 10)
    .map((e) => ({
      kind: "card_spotlight",
      id: `${e.set_id}-${e.number}`,
      name: e.name,
      setName: e.set_name ?? e.set_id,
      number: e.number,
      rarity: e.rarity ?? null,
      artist: e.artist ?? null,
      types: e.types ?? [],
      marketPrice: e.market_price,
      imageUrl: cardImageLarge(e.set_id, e.number),
      accentColor: typeColor(e.types),
    }));

  // ── Featured decks ────────────────────────────────────────────
  const { data: deckRowsData } = await supabase
    .from("saved_decks")
    .select("id, name, cover_image_url, like_count, user_id, analysis")
    .eq("is_public", true)
    .order("like_count", { ascending: false })
    .limit(10);
  const deckRows = (deckRowsData ?? []) as DeckRow[];

  // Resolve owner profiles
  const deckUserIds = Array.from(new Set(deckRows.map((d) => d.user_id)));
  const { data: deckProfiles } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .in("id", deckUserIds.length ? deckUserIds : ["00000000-0000-0000-0000-000000000000"]);
  const profById = new Map(
    (deckProfiles ?? []).map((p) => [
      p.id as string,
      p as { id: string; display_name: string; username: string },
    ]),
  );

  const featuredDecks: FeaturedDeckSubject[] = deckRows
    .filter((d) => profById.has(d.user_id))
    .map((d) => {
      const analysisCards = d.analysis?.cards ?? [];
      const primary = primaryPokemonCard(
        analysisCards.map((c) => ({
          qty: c.qty,
          name: c.name,
          number: c.number,
          setCode: c.setCode,
          section: c.section,
        })),
      );
      const prof = profById.get(d.user_id)!;
      return {
        kind: "featured_deck",
        id: d.id,
        name: d.name,
        username: prof.username,
        displayName: prof.display_name,
        coverImageUrl:
          d.cover_image_url ??
          (primary?.set_id
            ? `https://images.pokemontcg.io/${primary.set_id}/${primary.card.number}.png`
            : null),
        iconUrl: null,
        accentColor: typeColor(primary?.types),
        likeCount: d.like_count,
        price: d.analysis?.deckPrice ?? null,
      };
    });

  // ── Featured matches ──────────────────────────────────────────
  // Pull recent matches whose saved deck is public + verified-log
  // (source = 'tcg_live_log' matches the home page heuristic).
  const { data: matchRowsData } = await supabase
    .from("matches")
    .select(
      "id, result, opponent_archetype, opponent_handle, player_handle, saved_deck_id, source",
    )
    .eq("source", "tcg_live_log")
    .order("created_at", { ascending: false })
    .limit(30);
  const matchRowsRaw = (matchRowsData ?? []) as (MatchRow & { source: string })[];

  // Filter to matches whose deck is public
  const matchDeckIds = Array.from(new Set(matchRowsRaw.map((m) => m.saved_deck_id)));
  const { data: matchDeckRowsData } = await supabase
    .from("saved_decks")
    .select("id, name, cover_image_url, user_id, analysis, is_public")
    .in("id", matchDeckIds.length ? matchDeckIds : ["00000000-0000-0000-0000-000000000000"]);
  const matchDeckRows = (matchDeckRowsData ?? []) as (DeckRow & { is_public: boolean })[];
  const matchDeckById = new Map(matchDeckRows.filter((d) => d.is_public).map((d) => [d.id, d]));

  // Owner profiles for match decks
  const matchUserIds = Array.from(new Set(matchDeckRows.map((d) => d.user_id)));
  const { data: matchProfiles } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .in("id", matchUserIds.length ? matchUserIds : ["00000000-0000-0000-0000-000000000000"]);
  const matchProfById = new Map(
    (matchProfiles ?? []).map((p) => [
      p.id as string,
      p as { id: string; display_name: string; username: string },
    ]),
  );

  // Prize counts + opponent attacker (for the opponent-side card image)
  // pulled in parallel. Mirrors /battles/[id]'s resolution: top opponent
  // attacker by damage; fall back to highest-rank played/evolved Pokémon
  // when the opponent never swings (concede, KO'd before attacking).
  const matchIds = matchRowsRaw.map((m) => m.id);
  const matchIdsSafe = matchIds.length
    ? matchIds
    : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: prizeRows }, { data: attackRows }, { data: playRows }] =
    await Promise.all([
      supabase
        .from("match_actions")
        .select("match_id, actor, payload")
        .in("match_id", matchIdsSafe)
        .eq("action_type", "prize_taken"),
      supabase
        .from("match_actions")
        .select("match_id, payload")
        .in("match_id", matchIdsSafe)
        .eq("action_type", "attack")
        .eq("actor", "opponent"),
      supabase
        .from("match_actions")
        .select("match_id, action_type, payload")
        .in("match_id", matchIdsSafe)
        .eq("actor", "opponent")
        .in("action_type", ["play_to_active", "play_to_bench", "evolve"]),
    ]);

  const prizesByMatch = new Map<string, { player: number; opponent: number }>();
  for (const row of prizeRows ?? []) {
    const matchId = row.match_id as string;
    const actor = row.actor as "player" | "opponent";
    const count =
      typeof (row.payload as { count?: number })?.count === "number"
        ? (row.payload as { count: number }).count
        : 0;
    const cur = prizesByMatch.get(matchId) ?? { player: 0, opponent: 0 };
    if (actor === "player") cur.player += count;
    else if (actor === "opponent") cur.opponent += count;
    prizesByMatch.set(matchId, cur);
  }

  // Aggregate opponent attack damage per match → top attacker name
  const opponentDmgByMatch = new Map<string, Map<string, number>>();
  for (const row of attackRows ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const attacker = typeof payload?.attacker === "string" ? payload.attacker : null;
    const damage = typeof payload?.damage === "number" ? payload.damage : 0;
    if (!attacker || !damage) continue;
    const matchId = row.match_id as string;
    if (!opponentDmgByMatch.has(matchId)) opponentDmgByMatch.set(matchId, new Map());
    const m = opponentDmgByMatch.get(matchId)!;
    m.set(attacker, (m.get(attacker) ?? 0) + damage);
  }
  const topAttackerByMatch = new Map<string, string>();
  opponentDmgByMatch.forEach((attackerMap, matchId) => {
    let topName = "";
    let topDmg = 0;
    attackerMap.forEach((dmg, name) => {
      if (dmg > topDmg) {
        topDmg = dmg;
        topName = name;
      }
    });
    if (topName) topAttackerByMatch.set(matchId, topName);
  });

  // Fallback: highest-rank played/evolved Pokémon per match
  const playsByMatch = new Map<string, Map<string, number>>();
  for (const row of playRows ?? []) {
    const payload = row.payload as Record<string, unknown> | null;
    const name =
      row.action_type === "evolve"
        ? typeof payload?.to === "string"
          ? (payload.to as string)
          : null
        : typeof payload?.card === "string"
        ? (payload.card as string)
        : null;
    if (!name) continue;
    const matchId = row.match_id as string;
    if (!playsByMatch.has(matchId)) playsByMatch.set(matchId, new Map());
    const m = playsByMatch.get(matchId)!;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  playsByMatch.forEach((plays, matchId) => {
    if (topAttackerByMatch.has(matchId)) return;
    const synthetic: Array<{
      name: string;
      qty: number;
      number: string;
      setCode: string;
      section: "pokemon";
    }> = [];
    plays.forEach((qty, name) => {
      synthetic.push({ name, qty, number: "", setCode: "", section: "pokemon" });
    });
    const primary = primaryPokemonCard(synthetic);
    if (primary) topAttackerByMatch.set(matchId, primary.card.name);
  });

  const featuredMatches: FeaturedMatchSubject[] = matchRowsRaw
    .filter((m) => matchDeckById.has(m.saved_deck_id))
    .slice(0, 10)
    .map((m) => {
      const deck = matchDeckById.get(m.saved_deck_id)!;
      const prof = matchProfById.get(deck.user_id);
      const analysisCards = deck.analysis?.cards ?? [];
      const primary = primaryPokemonCard(
        analysisCards.map((c) => ({
          qty: c.qty,
          name: c.name,
          number: c.number,
          setCode: c.setCode,
          section: c.section,
        })),
      );
      const prizes = prizesByMatch.get(m.id) ?? { player: 0, opponent: 0 };
      const opponentAttacker = topAttackerByMatch.get(m.id) ?? null;
      const opponentImageUrl = opponentAttacker
        ? cardImageUrlForName(opponentAttacker)
        : null;
      const opponentAccentColor = typeColor(
        opponentAttacker ? cardTypesForName(opponentAttacker) : undefined,
      );
      return {
        kind: "featured_match",
        id: m.id,
        displayName: prof?.display_name ?? "Trainer",
        username: prof?.username ?? "trainer",
        deckName: deck.name,
        deckCoverUrl:
          deck.cover_image_url ??
          (primary?.set_id
            ? `https://images.pokemontcg.io/${primary.set_id}/${primary.card.number}.png`
            : null),
        opponentImageUrl,
        playerAccentColor: typeColor(primary?.types),
        opponentAccentColor,
        playerHandle: m.player_handle,
        opponentHandle: m.opponent_handle,
        opponentArchetype: m.opponent_archetype,
        result: m.result,
        playerPrizes: prizes.player,
        opponentPrizes: prizes.opponent,
      };
    });

  return (
    <SocialStudioClient
      spotlights={spotlights}
      metaArchetypes={metaArchetypes}
      cardSpotlights={cardSpotlights}
      featuredDecks={featuredDecks}
      featuredMatches={featuredMatches}
    />
  );
}
