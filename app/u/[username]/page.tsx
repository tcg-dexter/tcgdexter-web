import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserDeckCard } from "@/app/components/DeckPostCard";
import { primaryCardImageUrl } from "@/lib/primaryCardImage";
import MatchHeatMap from "@/app/profile/MatchHeatMap";
import { deckResult, viewerResult, type SharedMatchCore } from "@/lib/shared-matches";
import {
  CERTIFIED_TRAINER,
  listAchievements,
} from "@/lib/learn/achievements";
import CertifiedTrainerBadge from "@/app/learn/quiz/CertifiedTrainerBadge";

interface ProfileRow {
  id: string;
  display_name: string;
  username: string;
  bio: string | null;
  created_at: string;
  is_public: boolean;
}

interface DeckRow {
  id: string;
  name: string;
  analysis: {
    deckPrice?: number;
    metaMatch?: { archetypeName?: string | null; archetypeId?: string | null };
    rotation?: { ready?: boolean };
    sections?: { pokemon: number; trainer: number; energy: number };
    cards?: Array<{ qty: number; name: string; number: string; setCode: string; section: "pokemon" | "trainer" | "energy" }>;
  } | null;
  updated_at: string;
  like_count: number;
  is_public: boolean;
  cover_image_url: string | null;
}

interface MatchRow {
  saved_deck_id: string | null;
  result: string;
  played_at: string | null;
  created_at: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("display_name, username, bio, is_public")
    .eq("username", username.toLowerCase())
    .eq("is_public", true)
    .maybeSingle();
  if (!data) return { title: "Trainer Not Found — TCG Dexter" };
  const title = `${data.display_name} (@${data.username}) — TCG Dexter`;
  const description = data.bio?.trim() || `Public deck collection by ${data.display_name}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, username, bio, created_at, is_public")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!profile) notFound();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwner = viewer?.id === profile.id;

  if (!isOwner && !profile.is_public) notFound();

  const { data: decksRaw } = isOwner
    ? await supabase
        .from("saved_decks")
        .select("id, name, analysis, updated_at, like_count, is_public, cover_image_url")
        .eq("user_id", profile.id)
        .order("updated_at", { ascending: false })
    : await supabase
        .from("saved_decks")
        .select("id, name, analysis, updated_at, like_count, is_public, cover_image_url")
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .order("like_count", { ascending: false })
        .order("updated_at", { ascending: false });
  const decks = (decksRaw ?? []) as DeckRow[];

  let manualMatches: MatchRow[] = [];
  if (isOwner) {
    const { data: matches } = await supabase
      .from("matches")
      .select("saved_deck_id, result, played_at, created_at");
    manualMatches = (matches ?? []) as MatchRow[];
  }

  // Verified shared matches involving this user, finalized only.
  // Public to all viewers; we count both creator-side and opponent-side.
  const { data: sharedRaw } = await supabase
    .from("shared_matches")
    .select(
      `id, creator_user_id, opponent_user_id, creator_decklist_id, opponent_decklist_id,
       creator_result, opponent_result, status, final_outcome, final_winner_user_id,
       judge_ruled, finalized_at`
    )
    .eq("status", "finalized")
    .or(`creator_user_id.eq.${profile.id},opponent_user_id.eq.${profile.id}`);
  const sharedMatches = (sharedRaw ?? []) as SharedMatchCore[];

  // Per-deck W-L: manual (owner only) + verified (everyone)
  const deckWL = new Map<string, { w: number; l: number; d: number }>();
  for (const m of manualMatches) {
    if (!m.saved_deck_id) continue;
    const prev = deckWL.get(m.saved_deck_id) ?? { w: 0, l: 0, d: 0 };
    if (m.result === "win") prev.w++;
    else if (m.result === "loss") prev.l++;
    else if (m.result === "draw") prev.d++;
    deckWL.set(m.saved_deck_id, prev);
  }
  for (const sm of sharedMatches) {
    // Identify which deck belongs to this profile and bump its W-L bucket.
    const deckId =
      sm.creator_user_id === profile.id
        ? sm.creator_decklist_id
        : sm.opponent_decklist_id;
    if (!deckId) continue;
    const r = deckResult(sm, deckId);
    if (!r) continue;
    const prev = deckWL.get(deckId) ?? { w: 0, l: 0, d: 0 };
    if (r === "win") prev.w++;
    else if (r === "loss") prev.l++;
    else prev.d++;
    deckWL.set(deckId, prev);
  }

  // Global W-L: manual (owner only) + verified (public)
  const verifiedWins = sharedMatches.filter(
    (m) => viewerResult(m, profile.id) === "win"
  ).length;
  const verifiedLosses = sharedMatches.filter(
    (m) => viewerResult(m, profile.id) === "loss"
  ).length;
  const verifiedDraws = sharedMatches.filter(
    (m) => viewerResult(m, profile.id) === "draw"
  ).length;

  const manualWins = manualMatches.filter((m) => m.result === "win").length;
  const manualLosses = manualMatches.filter((m) => m.result === "loss").length;
  const manualDraws = manualMatches.filter((m) => m.result === "draw").length;

  const globalWins = (isOwner ? manualWins : 0) + verifiedWins;
  const globalLosses = (isOwner ? manualLosses : 0) + verifiedLosses;
  const globalDraws = (isOwner ? manualDraws : 0) + verifiedDraws;
  const globalTotal = globalWins + globalLosses + globalDraws;

  // Heatmap dates: manual played_at + verified finalized_at (owner only)
  const heatmapMatches: MatchRow[] = isOwner
    ? [
        ...manualMatches,
        ...sharedMatches.map<MatchRow>((m) => ({
          saved_deck_id:
            m.creator_user_id === profile.id
              ? m.creator_decklist_id
              : m.opponent_decklist_id,
          result:
            viewerResult(m, profile.id) ?? "draw",
          played_at: m.finalized_at ?? null,
          created_at: m.finalized_at ?? new Date().toISOString(),
        })),
      ]
    : [];

  const joinedDate = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
  const initial = profile.display_name.trim().charAt(0).toUpperCase();

  const achievements = await listAchievements(supabase, profile.id);
  const certifiedTrainer = achievements.find((a) => a.key === CERTIFIED_TRAINER);
  const certifiedDate = certifiedTrainer
    ? new Date(certifiedTrainer.earned_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const showAchievementsCard = isOwner || achievements.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      {/* Profile module */}
      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-xl font-bold text-text-secondary">
              {initial}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-text-primary leading-tight truncate">
                  {profile.display_name}
                </h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-sm text-text-muted">@{profile.username}</span>
                </div>
              </div>
              {isOwner && (
                <Link
                  href="/settings"
                  aria-label="Settings"
                  className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.75}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </Link>
              )}
            </div>

            {profile.bio && (
              <p className="text-sm text-text-secondary leading-relaxed mt-2 whitespace-pre-wrap">
                {profile.bio}
              </p>
            )}

            <div className="flex items-center gap-2 mt-3 text-xs text-text-muted flex-wrap">
              {globalTotal > 0 && (
                <>
                  <span>
                    <span className="font-semibold text-emerald-700">{globalWins}W</span>
                    {" · "}
                    <span className="font-semibold text-rose-700">{globalLosses}L</span>
                    {globalDraws > 0 && (
                      <>
                        {" · "}
                        <span className="font-semibold text-stone-600">{globalDraws}D</span>
                      </>
                    )}
                  </span>
                  <span>·</span>
                </>
              )}
              <span>Joined {joinedDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Achievements — earned badges (owner sees an empty state nudge) */}
      {showAchievementsCard && (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Achievements
          </h2>
          {certifiedTrainer ? (
            <div className="flex items-center gap-3">
              <CertifiedTrainerBadge size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  Certified Trainer
                </p>
                <p className="text-xs text-text-muted">
                  Earned {certifiedDate}
                </p>
              </div>
            </div>
          ) : (
            isOwner && (
              <p className="text-sm text-text-secondary">
                Pass the{" "}
                <Link
                  href="/learn/quiz"
                  className="text-accent hover:underline"
                >
                  Trainer Quiz
                </Link>{" "}
                to earn your first badge.
              </p>
            )
          )}
        </div>
      )}

      {/* Match heatmap — only for owner (manual match data is private) */}
      {isOwner && heatmapMatches.length > 0 && (
        <MatchHeatMap matches={heatmapMatches} />
      )}

      {/* Deck feed */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
          Decks
          {decks.length > 0 && (
            <span className="ml-2 text-sm font-normal text-text-muted">({decks.length})</span>
          )}
        </h2>

        {decks.length === 0 ? (
          <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
            <p className="text-sm text-text-secondary">
              {isOwner ? (
                <>
                  No decks yet.{" "}
                  <Link href="/" className="text-accent hover:underline">
                    Create your first profile →
                  </Link>
                </>
              ) : (
                <>{profile.display_name} hasn&apos;t shared any decks yet.</>
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {decks.map((deck) => {
              const price = deck.analysis?.deckPrice ?? null;
              const sections = deck.analysis?.sections ?? null;
              const wl = deckWL.get(deck.id) ?? null;
              const imageUrl =
                deck.cover_image_url ??
                primaryCardImageUrl(deck.analysis?.cards ?? []);
              return (
                <UserDeckCard
                  key={deck.id}
                  id={deck.id}
                  name={deck.name}
                  href={`/u/${profile.username}/${deck.id}`}
                  username={profile.username}
                  displayName={profile.display_name}
                  price={price}
                  counts={sections}
                  wl={wl}
                  likeCount={deck.like_count}
                  isPrivate={isOwner && !deck.is_public}
                  imageUrl={imageUrl}
                  ownerUserId={profile.id}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
