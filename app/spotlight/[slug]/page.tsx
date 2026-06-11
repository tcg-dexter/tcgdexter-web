import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserDeckCard } from "@/app/components/DeckPostCard";
import {
  primaryCardImageUrl,
  deckAvatarInfo,
  pokemonSlug,
  cardTypesForName,
  cardTypesForSetIdNumber,
} from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import ThemeColor from "@/app/components/ThemeColor";
import SpotlightAdminBar from "../components/SpotlightAdminBar";
import SpotlightQAThread from "../components/SpotlightQAThread";
import SpotlightHeader from "../components/SpotlightHeader";
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const previewMode = sp.preview === "1";
  const data = await loadSpotlight(slug);
  if (!data) notFound();
  const { spotlight, profile, decks } = data;

  // Is the viewer an admin? Drives the floating admin action bar
  // (Edit + Publish). Anon visitors never see drafts at all — RLS on
  // trainer_spotlights blocks the select unless is_published = true or
  // the viewer is admin — so reaching this branch with an unpublished
  // row implies the viewer is admin.
  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  let isAdmin = false;
  if (viewer) {
    const { data: me } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", viewer.id)
      .maybeSingle<{ is_admin: boolean }>();
    isAdmin = !!me?.is_admin;
  }

  // Banner accent colors — one per favorite slot, ordered Pokémon →
  // collection (first card) → play (first card). Resolved from the
  // energy type of the underlying card (or Pokémon-by-name for the
  // sprite slot). When a slot is empty we pass null and SpotlightHeader
  // gracefully collapses the gradient.
  const firstCollection = spotlight.favorite_collection_cards[0] ?? null;
  const firstPlay = spotlight.favorite_format_cards[0] ?? null;
  const accentColors: (string | null)[] = [
    spotlight.favorite_pokemon
      ? typeColor(cardTypesForName(spotlight.favorite_pokemon.name))
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

  return (
    <main className="min-h-dvh bg-bg pb-24 -mt-14 xl:mt-0">
      {/* Overlay the mobile/tablet sticky toolbar onto the banner: clear
          its background + blur so the banner shows through to the top
          of the viewport, and force the hamburger icon white so it
          stays legible over the gradient. Scoped below xl since the
          desktop sidebars replace the toolbar at xl+. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 1279px){
            [data-site-toolbar]{
              background:transparent !important;
              backdrop-filter:none !important;
              -webkit-backdrop-filter:none !important;
              border-color:transparent !important;
            }
            [data-site-toolbar] button[aria-label="Toggle navigation menu"]{color:#fff;}
          }`,
        }}
      />
      {/* Paint the iOS/Android status bar to the banner's leftmost
          accent so the gradient reads as continuing up into the
          device chrome instead of butting against a system color. */}
      <ThemeColor color={accentColors.find((c): c is string => !!c) ?? "#B0A89E"} />
      <SpotlightHeader
        displayName={profile.display_name}
        username={profile.username}
        avatarUrl={profile.avatar_url}
        headline={spotlight.headline}
        accentColors={accentColors}
        layout={spotlight.banner_layout}
        // All four items become draggable + resizable only when an
        // admin loads the preview surface. Public readers (and admins
        // on the canonical published page) see a static composition.
        editable={isAdmin && previewMode}
        spotlightId={spotlight.id}
        favoritePokemon={spotlight.favorite_pokemon}
        favoriteCollectionCards={spotlight.favorite_collection_cards ?? []}
        favoriteFormatCards={spotlight.favorite_format_cards ?? []}
        userImageUrl={spotlight.avatar_image_url}
        // Admin pill slots into the header bio block, just below the
        // headline. Hidden on published spotlights so the public-facing
        // page reads cleanly even for admins — edits to live spotlights
        // happen from the /admin/spotlight UI instead. The pill stays
        // on drafts where Reset / Edit / Publish are still relevant.
        headerAction={
          isAdmin && !spotlight.is_published ? (
            <SpotlightAdminBar
              spotlightId={spotlight.id}
              slug={spotlight.slug}
              isPublished={spotlight.is_published}
              // The fanned cards + corner Pokémon are now static; only
              // the uploaded user image is interactive, so the drag hint
              // is gated on its presence alone.
              showDragHint={previewMode && !!spotlight.avatar_image_url}
            />
          ) : undefined
        }
      />

      {/* Bio — long-form intro. The first sentence is painted with the
          site brand gradient via bg-clip-text so the opening hook
          announces itself before the body text takes over. */}
      {spotlight.bio &&
        (() => {
          // Match through the first sentence terminator (. ! ?) that's
          // followed by whitespace or end-of-string. Falls back to the
          // whole bio if no terminator is found (e.g. a one-liner).
          const m = spotlight.bio.match(/^[\s\S]*?[.!?](?=\s|$)/);
          const first = m ? m[0] : spotlight.bio;
          const rest = m ? spotlight.bio.slice(first.length) : "";
          return (
            <section className="mx-auto max-w-2xl px-6 mt-8">
              <p className="text-sm sm:text-base text-text-primary whitespace-pre-line leading-relaxed">
                <span className="bg-gradient-brand bg-clip-text text-transparent font-semibold">
                  {first}
                </span>
                {rest}
              </p>
            </section>
          );
        })()}

      <div className="mx-auto max-w-5xl px-4 sm:px-6 mt-8">
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

        {/* Q&A — rendered as a series of two-post conversation threads
            (Dexter asks, the featured trainer answers) so the section
            reads as a real interview rather than a flat FAQ. */}
        {spotlight.qa.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
              Q&amp;A
            </h2>
            <SpotlightQAThread
              qa={spotlight.qa}
              trainer={{
                displayName: profile.display_name,
                username: profile.username,
                avatarUrl: profile.avatar_url,
                // First non-null accent (favorite Pokémon when set,
                // else next available) drives the vertical-fade
                // gradient on the trainer's monogram fallback — same
                // logic the main header avatar uses, so the two
                // surfaces agree.
                accentColor:
                  accentColors.find((c): c is string => !!c) ?? "#B0A89E",
              }}
            />
          </section>
        )}

        {/* Spotlight History — only on published pages; drafts don't
            need a public archive link. Rendered as a black capsule to
            match the site's other primary actions. */}
        {spotlight.is_published && (
          <section className="mt-10 text-center">
            <Link
              href="/spotlight"
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full bg-black text-white border border-transparent hover:opacity-90 transition-opacity"
            >
              Spotlight History
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
