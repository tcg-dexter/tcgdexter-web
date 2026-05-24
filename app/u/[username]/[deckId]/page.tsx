import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type AnalysisResult, type DeckCreator } from "@/app/components/DeckProfileView";
import { repriceDeck } from "@/lib/reprice-deck";
import type { SharedDeckMatchRow } from "@/app/my-decks/[id]/MatchLog";
import DeckDetailClient from "./DeckDetailClient";

interface DeckRecord {
  id: string;
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
    .eq("id", deckId)
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
  const { data: deckRaw } = isOwner
    ? await supabase
        .from("saved_decks")
        .select("id, name, deck_list, analysis, notes, updated_at, user_id, like_count, is_public, cover_image_url")
        .eq("id", deckId)
        .eq("user_id", profile.id)
        .maybeSingle()
    : await supabase
        .from("saved_decks")
        .select("id, name, deck_list, analysis, notes, updated_at, user_id, like_count, is_public, cover_image_url")
        .eq("id", deckId)
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .maybeSingle();
  if (!deckRaw) notFound();
  const deck = deckRaw as DeckRecord;

  // Build canonical URL
  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "tcgdexter.com";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const canonicalShareUrl = `${proto}://${host}/u/${profile.username}/${deck.id}`;

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
      .select("id, result, opponent_name, opponent_archetype, opponent_deck_list, notes, played_at, source")
      .eq("saved_deck_id", deck.id)
      .order("played_at", { ascending: false });
    initialMatches = (matches ?? []) as MatchRecord[];
  }

  // Verified shared matches involving this deck (public). Hydrate the
  // opponent (the *other* participant from this deck's POV) so the row can
  // render their name and deck.
  const { data: sharedRaw } = await supabase
    .from("shared_matches")
    .select(
      `id, creator_user_id, opponent_user_id, creator_decklist_id, opponent_decklist_id,
       creator_result, opponent_result, status, final_outcome, final_winner_user_id,
       judge_ruled, finalized_at`
    )
    .eq("status", "finalized")
    .or(`creator_decklist_id.eq.${deck.id},opponent_decklist_id.eq.${deck.id}`)
    .order("finalized_at", { ascending: false });

  const initialSharedMatches: SharedDeckMatchRow[] = [];
  if (sharedRaw && sharedRaw.length > 0) {
    const otherUserIds = Array.from(
      new Set(
        sharedRaw
          .map((m) =>
            m.creator_user_id === profile.id ? m.opponent_user_id : m.creator_user_id
          )
          .filter(Boolean) as string[]
      )
    );
    const otherDeckIds = Array.from(
      new Set(
        sharedRaw
          .map((m) =>
            m.creator_decklist_id === deck.id
              ? m.opponent_decklist_id
              : m.creator_decklist_id
          )
          .filter(Boolean) as string[]
      )
    );

    const [{ data: oppProfiles }, { data: oppDecks }] = await Promise.all([
      otherUserIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, display_name, username")
            .in("id", otherUserIds)
        : Promise.resolve({ data: [] }),
      otherDeckIds.length > 0
        ? supabase
            .from("saved_decks")
            .select("id, name, analysis")
            .in("id", otherDeckIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profileById = new Map(
      (oppProfiles ?? []).map((p) => [p.id, p] as const)
    );
    const deckById = new Map((oppDecks ?? []).map((d) => [d.id, d] as const));

    for (const sm of sharedRaw) {
      const oppUserId =
        sm.creator_user_id === profile.id ? sm.opponent_user_id : sm.creator_user_id;
      const oppDeckId =
        sm.creator_decklist_id === deck.id
          ? sm.opponent_decklist_id
          : sm.creator_decklist_id;

      const opp = oppUserId ? profileById.get(oppUserId) : null;
      const oppDeck = oppDeckId ? deckById.get(oppDeckId) : null;

      initialSharedMatches.push({
        id: sm.id,
        creator_user_id: sm.creator_user_id,
        opponent_user_id: sm.opponent_user_id,
        creator_decklist_id: sm.creator_decklist_id,
        opponent_decklist_id: sm.opponent_decklist_id,
        creator_result: sm.creator_result,
        opponent_result: sm.opponent_result,
        status: sm.status,
        final_outcome: sm.final_outcome,
        final_winner_user_id: sm.final_winner_user_id,
        judge_ruled: sm.judge_ruled,
        finalized_at: sm.finalized_at,
        opponent_display_name: opp?.display_name ?? null,
        opponent_username: opp?.username ?? null,
        opponent_deck_name: oppDeck?.name ?? null,
        opponent_deck_archetype:
          ((oppDeck?.analysis as { metaMatch?: { archetypeName?: string | null } } | null)
            ?.metaMatch?.archetypeName) ?? null,
      });
    }
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
      initialSharedMatches={initialSharedMatches}
      viewerId={viewer?.id ?? null}
      initialNotes={deck.notes ?? ""}
      initialLiked={initialLiked}
      initialLikeCount={deck.like_count ?? 0}
      isAuthenticated={Boolean(viewer)}
      creator={creator}
      initialCoverImageUrl={deck.cover_image_url ?? null}
    />
  );
}
