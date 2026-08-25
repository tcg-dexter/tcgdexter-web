import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHeatCounts, type BattleRow } from "@/app/profile/BattleHeatMap";
import SectionHeader from "@/app/components/ui/SectionHeader";
import TrainersClient from "./TrainersClient";
import { HEAT_WEEKS, type TrainerPreview } from "./TrainerCard";

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

interface DeckRow {
  id: string;
  user_id: string;
  like_count: number | null;
}

/** PostgREST caps a single response at db.maxRows (default 1000). Both
 *  tables read here are whole-table scans that will cross that line as the
 *  app grows, and a silent truncation would show up as trainers with
 *  wrong-looking (or zero) deck counts rather than as an error — so page
 *  through explicitly, same shape as the card catalog's ownership fetch. */
const PAGE = 1000;
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await page(from, from + PAGE - 1);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Per-user battle activity for the directory's mini heat grids.
 *
 * ── What this deliberately does and doesn't show ──
 * Only battles attached to a PUBLIC deck of a public profile. That's the
 * same boundary `loadRecentBattles` draws for the /battles feed, where
 * these battles already appear by handle with their own public pages — so
 * nothing here is visible that wasn't already.
 *
 * It is NOT the same set the profile page's heat map draws, which is the
 * owner's full history including private decks and is shown to the owner
 * alone (see the `isOwner &&` guard there). A trainer's card in this
 * directory will therefore look quieter than their own profile does to
 * them, which is the correct direction for the difference to run.
 *
 * Needs the service-role client because `matches` is owner-only under RLS
 * — the RLS client would return an empty set for every trainer but the
 * viewer. If that client can't be built (the key is server-only and absent
 * in some environments) the grids render empty rather than the page
 * failing: activity is decoration here, not the point of the surface.
 */
async function loadPublicBattleHeat(
  decks: DeckRow[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!decks.length) return out;

  const userByDeck = new Map(decks.map((d) => [d.id, d.user_id]));

  // Eight weeks, not seven: the grid starts at the Sunday of the week seven
  // weeks back, which is up to six days earlier than "49 days ago". Cheap
  // slack beats an off-by-a-few-days hole in the leftmost column.
  const since = new Date();
  since.setDate(since.getDate() - 8 * 7);
  const sinceIso = since.toISOString();

  let rows: Array<BattleRow & { saved_deck_id: string | null }>;
  try {
    const admin = createAdminClient();
    rows = await fetchAllPages((from, to) =>
      admin
        .from("matches")
        .select("saved_deck_id, played_at, created_at")
        .not("saved_deck_id", "is", null)
        // A battle logged late carries an old played_at and a recent
        // created_at, and one logged normally the reverse — the grid buckets
        // by played_at ?? created_at, so either being in range can matter.
        .or(`played_at.gte.${sinceIso},created_at.gte.${sinceIso}`)
        .order("created_at", { ascending: false })
        .range(from, to),
    );
  } catch (err) {
    console.error("[trainers] battle heat unavailable:", err);
    return out;
  }

  const byUser = new Map<string, BattleRow[]>();
  for (const r of rows) {
    const userId = r.saved_deck_id ? userByDeck.get(r.saved_deck_id) : undefined;
    if (!userId) continue; // private deck, or a deck whose owner isn't public
    const list = byUser.get(userId);
    if (list) list.push(r);
    else byUser.set(userId, [r]);
  }

  // forEach rather than for..of: the tsconfig target predates iterating a
  // Map directly, and this file has no reason to be the one that changes it.
  byUser.forEach((battles, userId) => {
    out.set(userId, buildHeatCounts(battles, HEAT_WEEKS));
  });
  return out;
}

/**
 * Trainer directory — every public profile as a preview card.
 *
 * "Public" means exactly what /leaderboard means by it: `is_public = true`
 * AND a non-null username, since a profile without a handle has no
 * reachable /u/<username> URL to link to.
 *
 * The three highlighted stats (public decks, total likes, followers) are all
 * cheap and all genuinely public. A battles-logged total is deliberately NOT
 * among them: the profile page hides W/L from visitors, so a lifetime count
 * here would state a number that page withholds.
 *
 * The activity grid is a narrower thing and is fine: it covers only battles
 * on a trainer's PUBLIC decks, which already appear by handle in the
 * /battles feed with their own public pages. See loadPublicBattleHeat.
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

  const heatByUser = await loadPublicBattleHeat(decks);
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
      heat: heatByUser.get(p.id) ?? emptyHeat,
      createdAt: p.created_at,
      viewerFollows: following.has(p.id),
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
