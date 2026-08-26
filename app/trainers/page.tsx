import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { buildHeatCounts } from "@/app/profile/BattleHeatMap";
import SectionHeader from "@/app/components/ui/SectionHeader";
import TrainersClient from "./TrainersClient";
import type { TrainerPreview } from "./TrainerCard";
import {
  HEAT_WEEKS,
  fetchAllPages,
  loadPublicBattleActivity,
  type DeckRow,
} from "@/lib/trainerActivity";

export const metadata: Metadata = {
  title: "Trainers — TCG Dexter",
};

// Deliberately no `export const revalidate`: unlike /leaderboard's ranked
// snapshot, this page is per-viewer — the Following facet needs the signed-in
// user's follow set, and `createClient()` reads cookies, which opts the
// segment into dynamic rendering anyway. A revalidate value here would be
// dead config that reads like a cache guarantee.

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_accent: string | null;
  follower_count: number | null;
  created_at: string;
}

/**
 * Trainer directory — every public profile as a preview card.
 *
 * "Public" means exactly what /leaderboard means by it: `is_public = true`
 * AND a non-null username, since a profile without a handle has no
 * reachable /u/<username> URL to link to.
 *
 * The five footer stats (public decks, total likes, followers, matches,
 * wins) are all genuinely public: decks/likes/followers come straight off
 * `profiles`/`saved_decks`, and matches/wins cover only battles on a
 * trainer's PUBLIC decks — the same boundary the activity grid draws, and
 * ones that already appear by handle in the /battles feed with their own
 * public pages. See loadPublicBattleActivity. (The profile page itself
 * still hides W/L from visitors on ITS OWN full private history — that's a
 * different, larger set than what's tallied here.)
 */
export default async function TrainersPage() {
  const supabase = await createClient();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const [profiles, decks] = await Promise.all([
    fetchAllPages<ProfileRow>((from, to) =>
      supabase
        .from("profiles")
        .select(
          "id, username, display_name, bio, avatar_url, banner_accent, follower_count, created_at",
        )
        .eq("is_public", true)
        .not("username", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    // Minimal columns, tallied in memory — same aggregation /leaderboard
    // does, rather than adding a view or an RPC for one page. RLS already
    // limits this to decks whose owner is public.
    fetchAllPages<DeckRow>((from, to) =>
      supabase
        .from("saved_decks")
        .select("id, user_id, like_count")
        .eq("is_public", true)
        .order("user_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const totals = new Map<string, { deckCount: number; totalLikes: number }>();
  for (const d of decks) {
    const prev = totals.get(d.user_id) ?? { deckCount: 0, totalLikes: 0 };
    totals.set(d.user_id, {
      deckCount: prev.deckCount + 1,
      totalLikes: prev.totalLikes + (d.like_count ?? 0),
    });
  }

  const { heatByUser, statsByUser } = await loadPublicBattleActivity(decks);
  // A grid of nothing, for trainers with no public battles — so every card
  // is the same height whether or not there's activity to show. Built per
  // request, not once at module load: it encodes which days are still in
  // the future, and a long-lived server would carry a stale mask across
  // the next midnight.
  const emptyHeat = buildHeatCounts([], HEAT_WEEKS);

  // Who the viewer follows. `user_follows` is readable `to authenticated`
  // only, so this stays a no-op (and the Following facet stays hidden) for
  // anon visitors. One row per follow — small, and indexed on the follower.
  let following = new Set<string>();
  if (viewer) {
    const rows = await fetchAllPages<{ following_user_id: string }>((from, to) =>
      supabase
        .from("user_follows")
        .select("following_user_id")
        .eq("follower_user_id", viewer.id)
        .range(from, to),
    );
    following = new Set(rows.map((r) => r.following_user_id));
  }

  const trainers: TrainerPreview[] = profiles.map((p) => {
    const tally = totals.get(p.id) ?? { deckCount: 0, totalLikes: 0 };
    const matchTally = statsByUser.get(p.id) ?? { matchCount: 0, winCount: 0 };
    return {
      id: p.id,
      username: p.username,
      // display_name is nullable in the schema; the handle is the only
      // thing guaranteed to be present, so it's the fallback.
      displayName: p.display_name?.trim() || p.username,
      bio: p.bio,
      avatarUrl: p.avatar_url,
      bannerAccent: p.banner_accent,
      deckCount: tally.deckCount,
      totalLikes: tally.totalLikes,
      followerCount: p.follower_count ?? 0,
      matchCount: matchTally.matchCount,
      winCount: matchTally.winCount,
      heat: heatByUser.get(p.id) ?? emptyHeat,
      createdAt: p.created_at,
      viewerFollows: following.has(p.id),
      isViewer: !!viewer && viewer.id === p.id,
    };
  });

  // Base order matches the client's default sort (Likes ↓) so the server
  // markup and the first client render agree.
  trainers.sort(
    (a, b) =>
      b.totalLikes - a.totalLikes || a.displayName.localeCompare(b.displayName),
  );

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)]">
        <div className="mb-6">
          <SectionHeader title="Trainers" />
        </div>
        <TrainersClient trainers={trainers} isAuthed={!!viewer} />
      </div>
    </main>
  );
}
