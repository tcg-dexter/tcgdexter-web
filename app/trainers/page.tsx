import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SectionHeader from "@/app/components/ui/SectionHeader";
import TrainersClient from "./TrainersClient";
import type { TrainerPreview } from "./TrainerCard";
import type { TeamCardRef } from "@/app/u/[username]/TeamCards";

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
  team_cards: (TeamCardRef | null)[] | null;
  follower_count: number | null;
  created_at: string;
}

interface DeckRow {
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
 * Trainer directory — every public profile as a preview card.
 *
 * "Public" means exactly what /leaderboard means by it: `is_public = true`
 * AND a non-null username, since a profile without a handle has no
 * reachable /u/<username> URL to link to.
 *
 * The three highlighted stats (public decks, total likes, followers) are all
 * cheap and all genuinely public. Battles logged is deliberately NOT among
 * them: `matches` is owner-only under RLS (the public battles feed goes
 * through the service-role client), and the profile page already chooses to
 * hide W/L from visitors — surfacing a battle count here would leak a number
 * that page withholds, and would need an admin client to read at all.
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
          "id, username, display_name, bio, avatar_url, banner_accent, team_cards, follower_count, created_at",
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
        .select("user_id, like_count")
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
      // jsonb, so the column can hold anything the constraint allows —
      // guard the shape here rather than trusting it downstream, the same
      // way the profile page does before fanning it.
      teamCards: Array.isArray(p.team_cards) ? p.team_cards : [],
      deckCount: tally.deckCount,
      totalLikes: tally.totalLikes,
      followerCount: p.follower_count ?? 0,
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
