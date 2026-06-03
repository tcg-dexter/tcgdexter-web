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
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import MatchHeatMap from "@/app/profile/MatchHeatMap";
import {
  CERTIFIED_TRAINER,
  listAchievements,
} from "@/lib/learn/achievements";
import CertifiedTrainerBadge from "@/app/learn/quiz/CertifiedTrainerBadge";
import UserProfileHeader, {
  StatCard,
  bannerGradientFor,
  bannerTopColorFor,
  type BannerAccent,
} from "./UserProfileHeader";
import ThemeColor from "@/app/components/ThemeColor";
import { ResponsiveLabel } from "@/app/components/StatCard";
import AccentPicker from "./AccentPicker";
import TeamOfSix from "./TeamOfSix";

interface ProfileRow {
  id: string;
  display_name: string;
  username: string;
  bio: string | null;
  created_at: string;
  is_public: boolean;
  tcg_live_handle: string | null;
  avatar_url: string | null;
  banner_accent: string | null;
  team_of_6: (string | null)[] | null;
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
  created_at: string;
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

/** Longest consecutive `win` run across matches sorted by played_at
 *  (falling back to created_at). Used by the Streak stat tile. */
function computeLongestWinStreak(matches: MatchRow[]): number {
  const sorted = [...matches].sort((a, b) => {
    const ka = a.played_at ?? a.created_at;
    const kb = b.played_at ?? b.created_at;
    return ka.localeCompare(kb);
  });
  let best = 0;
  let cur = 0;
  for (const m of sorted) {
    if (m.result === "win") {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
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
    .select(
      "id, display_name, username, bio, created_at, is_public, tcg_live_handle, avatar_url, banner_accent, team_of_6"
    )
    .eq("username", username.toLowerCase())
    .maybeSingle<ProfileRow>();
  if (!profile) notFound();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwner = viewer?.id === profile.id;

  if (!isOwner && !profile.is_public) notFound();

  const { data: decksRaw } = isOwner
    ? await supabase
        .from("saved_decks")
        .select("id, name, analysis, updated_at, created_at, like_count, is_public, cover_image_url")
        .eq("user_id", profile.id)
        .order("updated_at", { ascending: false })
    : await supabase
        .from("saved_decks")
        .select("id, name, analysis, updated_at, created_at, like_count, is_public, cover_image_url")
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

  // Per-deck W-L: manual matches only (owner sees their own; visitors see none).
  const deckWL = new Map<string, { w: number; l: number; d: number }>();
  for (const m of manualMatches) {
    if (!m.saved_deck_id) continue;
    const prev = deckWL.get(m.saved_deck_id) ?? { w: 0, l: 0, d: 0 };
    if (m.result === "win") prev.w++;
    else if (m.result === "loss") prev.l++;
    else if (m.result === "draw") prev.d++;
    deckWL.set(m.saved_deck_id, prev);
  }

  // Global W-L: manual matches only (owner-only; visitors see no record).
  const globalWins = isOwner ? manualMatches.filter((m) => m.result === "win").length : 0;
  const globalLosses = isOwner ? manualMatches.filter((m) => m.result === "loss").length : 0;
  const winRate =
    globalWins + globalLosses > 0
      ? Math.round((globalWins / (globalWins + globalLosses)) * 100)
      : null;
  const longestStreak = isOwner ? computeLongestWinStreak(manualMatches) : null;

  // Heatmap dates: manual played_at (owner only — manual match data is private).
  const heatmapMatches: MatchRow[] = isOwner ? manualMatches : [];

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

  // Public deck stats (visible to both owner and visitor).
  const publicDeckCount = decks.filter((d) => d.is_public).length;
  const totalLikes = decks.reduce((s, d) => s + (d.like_count ?? 0), 0);
  const joinedYear = new Date(profile.created_at).getFullYear();

  // Visitor placeholder for owner-private cells.
  const ownerOnly = (value: string) => (isOwner ? value : "—");

  // Resolve once so the Wins tile and the match-activity heatmap pick
  // up the same banner accent as the header.
  const bannerGradient = bannerGradientFor(profile.banner_accent);

  // Render the team row for owners always (so they can start picking)
  // and for visitors only when the user has chosen at least one
  // Pokémon — otherwise the banner stays clean.
  const teamArray: (string | null)[] = Array.isArray(profile.team_of_6)
    ? profile.team_of_6
    : [];
  const hasAnyTeamPick = teamArray.some((slot) => !!slot);
  const showTeam = isOwner || hasAnyTeamPick;

  // Default suggestions shown in the team picker before the user types.
  // Owner with saved decks: the unique Pokémon driving each deck's
  // avatar (a quick way to bring their actual roster into the picker).
  // Owner with no decks: the top 10 meta archetypes by total entries
  // — a reasonable starting roster when there's no personal signal.
  // Visitors don't see the picker, so this stays empty for them.
  let teamSuggestions: string[] = [];
  if (isOwner) {
    if (decks.length > 0) {
      const seen = new Set<string>();
      for (const deck of decks) {
        const info = deckAvatarInfo(
          deck.analysis?.cards ?? [],
          deck.cover_image_url
        );
        if (info && !seen.has(info.name)) {
          seen.add(info.name);
          teamSuggestions.push(info.name);
        }
      }
    } else {
      const top10 = [
        ...(metaArchetypesRaw as Array<{ name: string; total_entries: number }>),
      ]
        .sort((a, b) => b.total_entries - a.total_entries)
        .slice(0, 10);
      teamSuggestions = top10.map((a) => a.name);
    }
  }

  const belowStats = (
    <>
      {/* Match Activity — owner-only (manual match data is private). */}
      {isOwner && heatmapMatches.length > 0 && (
        <MatchHeatMap matches={heatmapMatches} accent={profile.banner_accent} />
      )}

      {/* Achievements — earned badges; owner sees an empty-state nudge. */}
      {showAchievementsCard && (
        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
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
    </>
  );

  const stats = (
    <>
      <StatCard
        label="Wins"
        value={ownerOnly(globalWins.toLocaleString())}
        tone="gradient"
        gradientCss={bannerGradient}
      />
      <StatCard
        label="Losses"
        value={ownerOnly(globalLosses.toLocaleString())}
        tone="dark"
      />
      <StatCard
        label={<ResponsiveLabel mobile="W Rate" desktop="Win Rate" />}
        value={isOwner && winRate !== null ? `${winRate}%` : "—"}
        valueClass={
          isOwner && winRate !== null && winRate >= 60
            ? "text-amber-500"
            : "text-text-secondary"
        }
      />
      <StatCard
        label="Streak"
        value={isOwner && longestStreak !== null ? longestStreak.toLocaleString() : "—"}
        valueClass="text-emerald-600"
      />
      <StatCard label="Decks" value={decks.length.toLocaleString()} />
      <StatCard label="Public" value={publicDeckCount.toLocaleString()} />
      <StatCard
        label="Likes"
        value={totalLikes.toLocaleString()}
        valueClass="text-rose-600"
      />
      <StatCard label="Joined" value={String(joinedYear)} />
    </>
  );

  return (
    <main className="min-h-dvh flex flex-col bg-bg pb-24">
      {/* Paint the mobile sticky toolbar in the banner's top stop so
          the toolbar, the iOS status bar (set via ThemeColor below),
          and the banner all read as one continuous surface. Without
          this the toolbar leaves a visible seam between device chrome
          and banner. xl:hidden already scopes the toolbar to below-xl,
          so this only affects mobile/tablet. Mirrors the
          meta-archetype page treatment. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `[data-site-toolbar]{background:${bannerTopColorFor(
            profile.banner_accent
          )};backdrop-filter:none;-webkit-backdrop-filter:none}[data-site-toolbar] button[aria-label="Toggle navigation menu"]{color:#fff}`,
        }}
      />
      {/* Match the iOS Safari / Android Chrome status-bar color to the
          banner's top gradient stop so the gradient reads as one
          continuous surface from the device notch down through the
          banner. */}
      <ThemeColor color={bannerTopColorFor(profile.banner_accent)} />
      <UserProfileHeader
        displayName={profile.display_name}
        username={profile.username}
        bio={profile.bio}
        tcgLiveHandle={profile.tcg_live_handle}
        avatarUrl={profile.avatar_url}
        bannerAccent={profile.banner_accent}
        stats={stats}
        belowStats={belowStats}
        bannerOverlay={
          isOwner ? (
            <AccentPicker
              current={(profile.banner_accent ?? null) as BannerAccent | null}
            />
          ) : undefined
        }
        bannerCenter={
          showTeam ? (
            <TeamOfSix
              initial={teamArray}
              isOwner={isOwner}
              defaultSuggestions={teamSuggestions}
            />
          ) : undefined
        }
        actions={
          isOwner ? (
            <Link
              href="/settings"
              aria-label="Settings"
              className="flex items-center justify-center w-8 h-8 text-text-muted hover:text-text-primary transition-colors"
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
          ) : undefined
        }
      />

      {/* Deck feed — uses `px-4 sm:px-6` to match the gutter on the
          /my-decks collection page, so identical UserDeckCard rows
          present at the same width across both surfaces (16px mobile
          gutter, 24px sm+). */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 mt-6">
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
                  wl={deckWL.get(deck.id) ?? null}
                  likeCount={deck.like_count}
                  isPrivate={isOwner && !deck.is_public}
                  imageUrl={
                    deck.cover_image_url ?? primaryCardImageUrl(cards)
                  }
                  ownerUserId={profile.id}
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
        )}
      </div>
    </main>
  );
}
