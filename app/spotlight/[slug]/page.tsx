import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserDeckCard } from "@/app/components/DeckPostCard";
import {
  primaryCardImageUrl,
  deckAvatarInfo,
  pokemonSlug,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import SpotlightCardTile from "../components/SpotlightCardTile";
import SpotlightPokemonTile from "../components/SpotlightPokemonTile";
import type { TrainerSpotlightRow } from "../types";

interface ProfileRow {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
}

interface DeckRow {
  id: string;
  name: string;
  analysis: {
    deckPrice?: number;
    sections?: { pokemon: number; trainer: number; energy: number };
    cards?: Array<{
      qty: number;
      name: string;
      number: string;
      setCode: string;
      section: "pokemon" | "trainer" | "energy";
    }>;
  } | null;
  created_at: string;
  like_count: number;
  is_public: boolean;
  cover_image_url: string | null;
  user_id: string;
}

async function loadSpotlight(slug: string) {
  const supabase = await createClient();
  const { data: spotlight } = await supabase
    .from("trainer_spotlights")
    .select("*")
    .eq("slug", slug.toLowerCase())
    .maybeSingle<TrainerSpotlightRow>();
  if (!spotlight) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, bio")
    .eq("id", spotlight.profile_id)
    .maybeSingle<ProfileRow>();
  if (!profile) return null;

  let decks: DeckRow[] = [];
  if (spotlight.featured_deck_ids.length > 0) {
    const { data } = await supabase
      .from("saved_decks")
      .select(
        "id, name, analysis, created_at, like_count, is_public, cover_image_url, user_id"
      )
      .in("id", spotlight.featured_deck_ids);
    const byId = new Map((data ?? []).map((d) => [d.id, d as DeckRow]));
    decks = spotlight.featured_deck_ids
      .map((id) => byId.get(id))
      .filter((d): d is DeckRow => !!d);
  }

  return { spotlight, profile, decks };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadSpotlight(slug);
  if (!data) return { title: "Trainer Spotlight — TCG Dexter" };
  const { profile, spotlight } = data;
  const title = `${profile.display_name} (@${profile.username}) — Trainer Spotlight`;
  const description =
    spotlight.headline ?? `Get to know ${profile.display_name}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function SpotlightPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadSpotlight(slug);
  if (!data) notFound();
  const { spotlight, profile, decks } = data;

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8">
        {/* Header */}
        <header className="rounded-2xl bg-white border border-black/8 shadow-sm p-6 flex items-center gap-4">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={profile.display_name}
              className="w-16 h-16 rounded-full object-cover border border-black/8"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[var(--surface)] flex items-center justify-center text-xl font-semibold text-text-secondary">
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-1">
              Trainer Spotlight
            </div>
            <h1 className="text-2xl font-bold text-text-primary leading-tight">
              {profile.display_name}{" "}
              <Link
                href={`/u/${profile.username}`}
                className="text-base font-normal text-text-muted hover:text-accent"
              >
                @{profile.username}
              </Link>
            </h1>
            {spotlight.headline && (
              <p className="text-sm text-text-secondary mt-1">
                {spotlight.headline}
              </p>
            )}
          </div>
        </header>

        {/* Favorites */}
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
            Favorites
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SpotlightPokemonTile
              label="Favorite Pokémon"
              pokemon={spotlight.favorite_pokemon}
            />
            <SpotlightCardTile
              label="Favorite in Collection"
              card={spotlight.favorite_collection_card}
            />
            <SpotlightCardTile
              label="Favorite to Play"
              card={spotlight.favorite_format_card}
            />
          </div>
        </section>

        {/* Featured decks */}
        {decks.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
              Featured Decks
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {decks.map((deck) => {
                const cards = deck.analysis?.cards ?? [];
                const avatar = deckAvatarInfo(cards, deck.cover_image_url);
                const slug = avatar ? pokemonSlug(avatar.name) : "";
                return (
                  <UserDeckCard
                    key={deck.id}
                    id={deck.id}
                    name={deck.name}
                    href={`/u/${profile.username}/${deck.id}`}
                    username={profile.username}
                    displayName={profile.display_name}
                    price={deck.analysis?.deckPrice ?? null}
                    counts={deck.analysis?.sections ?? null}
                    likeCount={deck.like_count}
                    imageUrl={
                      deck.cover_image_url ?? primaryCardImageUrl(cards)
                    }
                    ownerUserId={deck.user_id}
                    createdAt={deck.created_at}
                    iconUrl={
                      slug
                        ? `https://r2.limitlesstcg.net/pokemon/gen9/${slug}.png`
                        : null
                    }
                    iconBg={avatar ? typeColor(avatar.types) : null}
                    cards={cards}
                    coverImageUrl={deck.cover_image_url}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Q&A */}
        {spotlight.qa.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
              Q&amp;A
            </h2>
            <div className="rounded-2xl bg-white border border-black/8 shadow-sm divide-y divide-black/8">
              {spotlight.qa.map((item, i) => (
                <div key={i} className="p-5">
                  <dt className="text-sm font-semibold text-text-primary mb-1">
                    {item.q}
                  </dt>
                  <dd className="text-sm text-text-secondary whitespace-pre-line">
                    {item.a}
                  </dd>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
