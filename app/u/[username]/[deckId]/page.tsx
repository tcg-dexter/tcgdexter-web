import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type AnalysisResult, type DeckCreator } from "@/app/components/DeckProfileView";
import { repriceDeck } from "@/lib/reprice-deck";
import type { GamePrize } from "@/lib/bo3";
import DeckDetailClient from "./DeckDetailClient";

interface DeckRecord {
  id: string;
  short_id: string;
  name: string;
  deck_list: string;
  analysis: AnalysisResult;
  notes: string | null;
  updated_at: string;
  user_id: string;
  like_count: number;
  is_public: boolean;
  cover_image_url: string | null;
}

interface ProfileRecord {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  is_public: boolean;
}

interface MatchRecord {
  id: string;
  result: "win" | "loss" | "draw";
  opponent_name: string | null;
  opponent_archetype: string | null;
  opponent_deck_list: string | null;
  notes: string | null;
  played_at: string;
  source: "manual" | "tcg_live_log";
  game_results: string | null;
  prizes_taken_player: number | null;
  prizes_taken_opponent: number | null;
  game_prizes: GamePrize[] | null;
}

/**
 * URL params on this route accept either the deck's short_id (the new
 * shareable form, e.g. /u/dexter/k8m2x7q9) or the deck's UUID (legacy
 * links shared before short_ids existed). Match short_id first so the
 * common path is one round-trip; only legacy UUID-shaped values fall
 * through to the id lookup.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deckIdColumn(value: string): "id" | "short_id" {
  return UUID_RE.test(value) ? "id" : "short_id";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; deckId: string }>;
}): Promise<Metadata> {
  const { username, deckId } = await params;
  const supabase = await createClient();
  const { data: owner } = await supabase
    .from("profiles")
    .select("id, display_name, username, is_public")
    .eq("username", username.toLowerCase())
    .eq("is_public", true)
    .maybeSingle();
  if (!owner) return { title: "Deck Not Found — TCG Dexter" };
  const { data: deck } = await supabase
    .from("saved_decks")
    .select("name, analysis")
    .eq(deckIdColumn(deckId), deckId)
    .eq("user_id", owner.id)
    .eq("is_public", true)
    .maybeSingle();
  if (!deck) return { title: "Deck Not Found — TCG Dexter" };

  const archetype = (deck.analysis as AnalysisResult)?.metaMatch?.archetypeName ?? null;
  const title = archetype
    ? `${archetype} by @${owner.username} — TCG Dexter`
    : `${deck.name} by @${owner.username} — TCG Dexter`;
  const description = `${deck.name} — a public deck shared by ${owner.display_name}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function DeckPage({
  params,
}: {
  params: Promise<{ username: string; deckId: string }>;
}) {
  const { username, deckId } = await params;
  const supabase = await createClient();

  // Fetch profile without is_public filter so owners can see their own page
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, is_public")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!profile) notFound();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwner = viewer?.id === profile.id;

  // Non-owner visitors can only see public profiles
  if (!isOwner && !profile.is_public) notFound();

  // Owner sees their own decks regardless of is_public; visitors need is_public=true
  const lookupCol = deckIdColumn(deckId);
  const { data: deckRaw } = isOwner
    ? await supabase
        .from("saved_decks")
        .select("id, short_id, name, deck_list, analysis, notes, updated_at, user_id, like_count, is_public, cover_image_url")
        .eq(lookupCol, deckId)
        .eq("user_id", profile.id)
        .maybeSingle()
    : await supabase
        .from("saved_decks")
        .select("id, short_id, name, deck_list, analysis, notes, updated_at, user_id, like_count, is_public, cover_image_url")
        .eq(lookupCol, deckId)
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .maybeSingle();
  if (!deckRaw) notFound();
  const deck = deckRaw as DeckRecord;

  // Build canonical URL — always the short_id form so OG cards and
  // copy-link buttons surface the friendly link, even if the visitor
  // arrived via a legacy UUID URL.
  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "tcgdexter.com";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const canonicalShareUrl = `${proto}://${host}/u/${profile.username}/${deck.short_id}`;

  // Live reprice
  const live = repriceDeck(deck.deck_list);
  const analysis: AnalysisResult = {
    ...deck.analysis,
    deckPrice: live.deckPrice,
    rotation: live.rotation,
  };

  // Owner-only: fetch manual matches for this deck
  let initialMatches: MatchRecord[] = [];
  if (isOwner) {
    const { data: matches } = await supabase
      .from("matches")
      .select("id, result, opponent_name, opponent_archetype, opponent_deck_list, notes, played_at, source, game_results, prizes_taken_player, prizes_taken_opponent, game_prizes")
      .eq("saved_deck_id", deck.id)
      .order("played_at", { ascending: false });
    initialMatches = (matches ?? []) as MatchRecord[];
  }

  // Visitor-only: check if current user has liked this deck
  let initialLiked = false;
  if (!isOwner && viewer) {
    const { data: likeRow } = await supabase
      .from("deck_likes")
      .select("user_id")
      .eq("user_id", viewer.id)
      .eq("saved_deck_id", deck.id)
      .maybeSingle();
    initialLiked = Boolean(likeRow);
  }

  const creator: DeckCreator = {
    displayName: profile.display_name,
  };

  return (
    <DeckDetailClient
      isOwner={isOwner}
      username={profile.username}
      savedDeckId={deck.id}
      deckList={deck.deck_list}
      analysis={analysis}
      profiledAt={deck.updated_at}
      pageTitle={deck.name}
      initialIsPublic={deck.is_public}
      canonicalShareUrl={canonicalShareUrl}
      initialMatches={initialMatches}
      initialNotes={deck.notes ?? ""}
      initialLiked={initialLiked}
      initialLikeCount={deck.like_count ?? 0}
      isAuthenticated={Boolean(viewer)}
      creator={creator}
      initialCoverImageUrl={deck.cover_image_url ?? null}
    />
  );
}
