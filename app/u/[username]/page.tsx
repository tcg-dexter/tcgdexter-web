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
import BattleHeatMap from "@/app/profile/BattleHeatMap";
import UserProfileHeader, {
  StatCard,
  bannerGradientFor,
  bannerTopColorFor,
  type BannerAccent,
} from "./UserProfileHeader";
import ThemeColor from "@/app/components/ThemeColor";
import { ResponsiveLabel } from "@/app/components/StatCard";
import StreakFlame from "@/app/components/StreakFlame";
import { displayCurrentStreak, type StreakRow } from "@/lib/streak";
import AccentPicker from "./AccentPicker";
import TeamCards, { type TeamCardRef } from "./TeamCards";
import { BattleCard } from "@/app/components/BattleCard";
import { loadOwnerRecentBattles } from "@/lib/recent-battles";
import ProfileTabs from "./ProfileTabs";
import AchievementsModule from "./AchievementsModule";
import {
  listAchievements,
  reconcileAchievements,
  CERTIFIED_TRAINER,
} from "@/lib/learn/achievements";
import { notifyBadgesUnlocked } from "@/lib/notifications/notify";
import GetStartedChecklist from "@/app/my-decks/GetStartedChecklist";
import FollowButton from "./FollowButton";
import { FollowPanelProvider } from "./FollowPanel";
import FollowStats from "./FollowStats";
import FollowPanelBody from "./FollowPanelBody";
import { hydrateListPreviews, type ListRow } from "@/lib/lists";
import ListPreviewCard from "@/app/cards/ListPreviewCard";

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
  team_cards: (TeamCardRef | null)[] | null;
  onboarding_dismissed: boolean;
  follower_count: number;
  following_count: number;
}

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
  cover_image_url: string | null;
}

interface BattleRow {
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

/** Stat-grid tile for a daily streak (flame + count). Matches the default
 *  StatCard chrome; used for both Current and Longest streak. */
function StreakStatTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <div className="flex items-center justify-center gap-1">
        <StreakFlame count={count} size="md" showCount={false} />
        <span className="text-lg font-bold tabular-nums text-text-primary">
          {count.toLocaleString()}
        </span>
      </div>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
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
      "id, display_name, username, bio, created_at, is_public, tcg_live_handle, avatar_url, banner_accent, team_cards, onboarding_dismissed, follower_count, following_count"
    )
    .eq("username", username.toLowerCase())
    .maybeSingle<ProfileRow>();
  if (!profile) notFound();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwner = viewer?.id === profile.id;

  if (!isOwner && !profile.is_public) notFound();

  // Does the signed-in visitor already follow this profile? Drives the
  // Follow/Following button's initial state. Owner never sees the button.
  let viewerFollows = false;
  if (viewer && !isOwner) {
    const { data: followRow } = await supabase
      .from("user_follows")
      .select("follower_user_id")
      .eq("follower_user_id", viewer.id)
      .eq("following_user_id", profile.id)
      .maybeSingle();
    viewerFollows = !!followRow;
  }

  const { data: decksRaw } = isOwner
    ? await supabase
        .from("saved_decks")
        .select("id, short_id, name, deck_list, analysis, updated_at, created_at, like_count, is_public, cover_image_url")
        .eq("user_id", profile.id)
        .order("updated_at", { ascending: false })
    : await supabase
        .from("saved_decks")
        .select("id, short_id, name, deck_list, analysis, updated_at, created_at, like_count, is_public, cover_image_url")
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .order("like_count", { ascending: false })
        .order("updated_at", { ascending: false });
  const decks = (decksRaw ?? []) as DeckRow[];

  const { data: listsRaw } = isOwner
    ? await supabase
        .from("lists")
        .select("id, short_id, name, is_public")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
    : await supabase
        .from("lists")
        .select("id, short_id, name, is_public")
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .order("created_at", { ascending: false });
  const lists = await hydrateListPreviews(
    supabase,
    profile.username,
    (listsRaw ?? []) as ListRow[],
  );

  let manualBattles: BattleRow[] = [];
  if (isOwner) {
    const { data: battles } = await supabase
      .from("matches")
      .select("saved_deck_id, result, played_at, created_at");
    manualBattles = (battles ?? []) as BattleRow[];
  }

  // Per-deck W-L: manual battles only (owner sees their own; visitors see none).
  const deckWL = new Map<string, { w: number; l: number; d: number }>();
  for (const m of manualBattles) {
    if (!m.saved_deck_id) continue;
    const prev = deckWL.get(m.saved_deck_id) ?? { w: 0, l: 0, d: 0 };
    if (m.result === "win") prev.w++;
    else if (m.result === "loss") prev.l++;
    else if (m.result === "draw") prev.d++;
    deckWL.set(m.saved_deck_id, prev);
  }

  // Global W-L: manual battles only (owner-only; visitors see no record).
  const globalWins = isOwner ? manualBattles.filter((m) => m.result === "win").length : 0;
  const globalLosses = isOwner ? manualBattles.filter((m) => m.result === "loss").length : 0;
  const winRate =
    globalWins + globalLosses > 0
      ? Math.round((globalWins / (globalWins + globalLosses)) * 100)
      : null;

  // Daily battle-logging streak — public (shown to visitors too), reads as
  // 0 once it lapses (see displayCurrentStreak). Backed by user_streaks.
  const { data: streakRow } = await supabase
    .from("user_streaks")
    .select("current_streak, longest_streak, last_logged_date, timezone")
    .eq("user_id", profile.id)
    .maybeSingle();
  const dayStreak = displayCurrentStreak(streakRow as StreakRow | null);
  // Longest is a historical high-water mark — not subject to the alive
  // check, so it persists even after the current streak lapses.
  const longestStreak = (streakRow as StreakRow | null)?.longest_streak ?? 0;

  // Achievements — badges render on the public profile. For the owner we
  // reconcile first: a self-healing backfill that awards any count-based
  // badges earned before this feature shipped (or before their next
  // log/save). RLS permits self-inserts only, so it's a no-op for visitors,
  // who simply read the already-earned rows.
  if (isOwner) {
    const newlyAwarded = await reconcileAchievements(supabase, profile.id);
    void notifyBadgesUnlocked(profile.id, newlyAwarded);
  }
  const earnedAchievements = await listAchievements(supabase, profile.id);

  // Get Started onboarding checklist — owner-only. Guides new users through
  // the core loop (save a deck → log a battle → ace the quiz). Shown even at
  // zero decks here (leads with "save your first deck"); its "Log a battle"
  // CTA links to /my-decks (no in-place log drawer on the profile). Auto-hides
  // once complete or dismissed.
  const getStarted = isOwner ? (
    <GetStartedChecklist
      hasDeck={decks.length > 0}
      hasBattle={manualBattles.length > 0}
      hasPublicDeck={decks.some((d) => d.is_public)}
      hasQuiz={earnedAchievements.some((a) => a.key === CERTIFIED_TRAINER)}
      initialDismissed={profile.onboarding_dismissed}
    />
  ) : null;

  // Heatmap dates: manual played_at (owner only — manual battle data is private).
  const heatmapBattles: BattleRow[] = isOwner ? manualBattles : [];

  // Public deck stats (visible to both owner and visitor).
  const publicDeckCount = decks.filter((d) => d.is_public).length;
  const totalLikes = decks.reduce((s, d) => s + (d.like_count ?? 0), 0);

  // Owner sees a 3-most-recently-created preview with a "View All" link
  // to /my-decks (their own saved-deck library — not meaningful for a
  // visitor, so visitors keep the full unranked public-decks list as
  // before). Sorted by created_at rather than the query's updated_at.
  const previewDecks = isOwner
    ? [...decks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)
    : decks;

  // Recent Battles — owner-only (manual battle data is private). Reuses
  // the same BattleCard/RecentBattle pipeline as the public /battles feed,
  // scoped to just this owner's own decks.
  const recentBattles = isOwner
    ? await loadOwnerRecentBattles(supabase, profile.id, profile.username, 3)
    : [];

  // Visitor placeholder for owner-private cells.
  const ownerOnly = (value: string) => (isOwner ? value : "—");

  // Resolve once so the Wins tile and the battle-activity heatmap pick
  // up the same banner accent as the header.
  const bannerGradient = bannerGradientFor(profile.banner_accent);

  // Render the team fan for owners always (so they can start picking)
  // and for visitors only when the user has chosen at least one card —
  // otherwise the banner stays clean.
  const teamArray: (TeamCardRef | null)[] = Array.isArray(profile.team_cards)
    ? profile.team_cards
    : [];
  const hasAnyTeamPick = teamArray.some((slot) => !!slot);
  const showTeam = isOwner || hasAnyTeamPick;

  // Left column, under the stat grid — Battle Activity (owner-only; manual
  // battle data is private).
  const belowStats =
    isOwner && heatmapBattles.length > 0 ? (
      <BattleHeatMap battles={heatmapBattles} accent={profile.banner_accent} />
    ) : undefined;

  // Right column — Achievements. Earned badges are public (visitors see
  // them too); the locked "goals" drawer is owner-only. Hidden entirely
  // for a visitor viewing a profile with no earned badges.
  const sideModule =
    isOwner || earnedAchievements.length > 0 ? (
      <AchievementsModule
        earnedKeys={earnedAchievements.map((a) => a.key)}
        showLocked={isOwner}
      />
    ) : undefined;

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
      {/* Daily battle-logging streak (public) — current + all-time best. */}
      <StreakStatTile label="Current" count={dayStreak} />
      <StatCard label="Decks" value={decks.length.toLocaleString()} />
      <StatCard label="Public" value={publicDeckCount.toLocaleString()} />
      <StatCard
        label="Likes"
        value={totalLikes.toLocaleString()}
        valueClass="text-rose-600"
      />
      <StreakStatTile label="Longest" count={longestStreak} />
    </>
  );

  // Compact follower/following counts under the @handle (owner + visitor).
  // Each count is clickable and swaps the profile body for the matching
  // list in place (see FollowStats / FollowPanelBody).
  const followStats = (
    <FollowStats
      followerCount={profile.follower_count ?? 0}
      followingCount={profile.following_count ?? 0}
    />
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
      <FollowPanelProvider>
      <UserProfileHeader
        displayName={profile.display_name}
        username={profile.username}
        bio={profile.bio}
        tcgLiveHandle={profile.tcg_live_handle}
        avatarUrl={profile.avatar_url}
        isOwner={isOwner}
        bannerAccent={profile.banner_accent}
        followStats={followStats}
        bannerOverlay={
          isOwner ? (
            <AccentPicker
              current={(profile.banner_accent ?? null) as BannerAccent | null}
              teamCards={teamArray}
            />
          ) : undefined
        }
        bannerFan={
          showTeam ? <TeamCards initial={teamArray} isOwner={isOwner} /> : undefined
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
          ) : (
            <FollowButton
              targetUserId={profile.id}
              initialFollowing={viewerFollows}
              isAuthenticated={!!viewer}
            />
          )
        }
      />

      <FollowPanelBody
        targetUserId={profile.id}
        username={profile.username}
        displayName={profile.display_name}
      >
        {/* Top modules (stat grid, battle activity, achievements) — lifted
            out of the header so this whole region can be swapped for the
            followers/following list. On lg+ stats+activity and badges split
            3:2; below lg they stack. */}
        <div className="px-4 sm:px-8 mt-6">
          {getStarted}
          {sideModule ? (
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3 space-y-6">
                <div className="grid grid-cols-4 gap-3">{stats}</div>
                {belowStats}
              </div>
              <div className="lg:col-span-2">{sideModule}</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">{stats}</div>
              {belowStats && <div className="mt-6 space-y-6">{belowStats}</div>}
            </>
          )}
        </div>

      {/* Deck feed — full-width within the layout's content column.
          Mobile keeps a tight 16px gutter; sm+ opens to 32px so the
          grid breathes against the edges instead of sitting flush.
          Owner gets My Decks / Recent Battles as segmented tabs (both
          are private-scoped previews with their own "View All");
          visitors have nothing to tab between, so they keep the plain
          public-decks list. */}
      <div className="px-4 sm:px-8 mt-6">
        {isOwner ? (
          <ProfileTabs
            accentColor={bannerTopColorFor(profile.banner_accent)}
            decksCount={decks.length}
            decksViewAllHref="/my-decks"
            showDecksViewAll={decks.length > 0}
            decksContent={
              decks.length === 0 ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
                  <p className="text-sm text-text-secondary">
                    No decks yet.{" "}
                    <Link href="/" className="text-accent hover:underline">
                      Create your first profile →
                    </Link>
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {previewDecks.map((deck, i) => {
                    const cards = deck.analysis?.cards ?? [];
                    const avatar = deckAvatarInfo(cards, deck.cover_image_url);
                    const slug = avatar ? pokemonSlug(avatar.name) : "";
                    return (
                      <UserDeckCard
                        key={deck.id}
                        id={deck.id}
                        name={deck.name}
                        href={`/u/${profile.username}/${deck.short_id}`}
                        username={profile.username}
                        displayName={profile.display_name}
                        price={deck.analysis?.deckPrice ?? null}
                        counts={deck.analysis?.sections ?? null}
                        wl={deckWL.get(deck.id) ?? null}
                        likeCount={deck.like_count}
                        isPrivate={isOwner && !deck.is_public}
                        imageUrl={deck.cover_image_url ?? primaryCardImageUrl(cards)}
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
                        deckList={deck.deck_list}
                        isPublic={deck.is_public}
                        canManage={isOwner}
                        index={i}
                      />
                    );
                  })}
                </div>
              )
            }
            battlesCount={manualBattles.length}
            battlesViewAllHref="/battles?filter=mine"
            showBattlesViewAll={recentBattles.length > 0}
            battlesContent={
              recentBattles.length === 0 ? (
                <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
                  <p className="text-sm text-text-secondary">
                    No battles logged yet. Log a battle from any of your decks to see it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recentBattles.map((battle) => (
                    <BattleCard key={battle.id} battle={battle} />
                  ))}
                </div>
              )
            }
          />
        ) : (
          <>
            <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
              Decks
              {decks.length > 0 && (
                <span className="ml-2 text-sm font-normal text-text-muted">({decks.length})</span>
              )}
            </h2>
            {decks.length === 0 ? (
              <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
                <p className="text-sm text-text-secondary">
                  {profile.display_name} hasn&apos;t shared any decks yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {decks.map((deck, i) => {
                  const cards = deck.analysis?.cards ?? [];
                  const avatar = deckAvatarInfo(cards, deck.cover_image_url);
                  const slug = avatar ? pokemonSlug(avatar.name) : "";
                  return (
                    <UserDeckCard
                      key={deck.id}
                      id={deck.id}
                      name={deck.name}
                      href={`/u/${profile.username}/${deck.short_id}`}
                      username={profile.username}
                      displayName={profile.display_name}
                      price={deck.analysis?.deckPrice ?? null}
                      counts={deck.analysis?.sections ?? null}
                      wl={deckWL.get(deck.id) ?? null}
                      likeCount={deck.like_count}
                      isPrivate={false}
                      imageUrl={deck.cover_image_url ?? primaryCardImageUrl(cards)}
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
                      deckList={deck.deck_list}
                      isPublic={deck.is_public}
                      canManage={false}
                      index={i}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {(isOwner || lists.length > 0) && (
        <div className="px-4 sm:px-8 mt-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3 px-1">
            Lists
            {lists.length > 0 && (
              <span className="ml-2 text-sm font-normal text-text-muted">({lists.length})</span>
            )}
          </h2>
          {lists.length === 0 ? (
            <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
              <p className="text-sm text-text-secondary">
                {isOwner ? (
                  <>
                    No lists yet.{" "}
                    <Link href="/cards" className="text-accent hover:underline">
                      Start one from Card Catalog →
                    </Link>
                  </>
                ) : (
                  `${profile.display_name} hasn't shared any lists yet.`
                )}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {lists.map((l) => (
                <ListPreviewCard key={l.id} list={l} />
              ))}
            </div>
          )}
        </div>
      )}
      </FollowPanelBody>
      </FollowPanelProvider>
    </main>
  );
}
