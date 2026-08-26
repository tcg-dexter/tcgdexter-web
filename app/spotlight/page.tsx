import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { buildHeatCounts } from "@/app/profile/BattleHeatMap";
import SectionHeader from "@/app/components/ui/SectionHeader";
import { TrainerCard, type TrainerPreview } from "@/app/trainers/TrainerCard";
import {
  HEAT_WEEKS,
  fetchAllPages,
  loadPublicBattleActivity,
  type DeckRow,
} from "@/lib/trainerActivity";
import type { TrainerSpotlightRow } from "./types";

export const metadata: Metadata = {
  title: "Spotlight History — TCG Dexter",
  description:
    "Every Trainer Spotlight TCG Dexter has published — browse the archive.",
};

interface SpotlightRow extends Pick<TrainerSpotlightRow, "id" | "slug" | "published_at"> {
  profiles: {
    id: string;
    username: string;
    display_name: string | null;
    bio: string | null;
    avatar_url: string | null;
    banner_accent: string | null;
    follower_count: number | null;
    created_at: string;
  } | null;
}

/**
 * Spotlight archive — every published Trainer Spotlight, rendered with the
 * same TrainerCard grid the /trainers directory uses (shared component,
 * shared page shell) rather than a bespoke banner-row list. That means the
 * same real Follow button and public Decks/Likes/Followers/Matches/Wins
 * stats a directory card shows, built the same privacy-scoped way — see
 * loadPublicBattleActivity in lib/trainerActivity.ts.
 *
 * Order matches the spotlight publish order (newest first), not the
 * directory's Likes sort — this is a chronological archive, not a ranked
 * leaderboard cut.
 */
export default async function SpotlightIndex() {
  const supabase = await createClient();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("trainer_spotlights")
    .select(
      "id, slug, published_at, profiles!trainer_spotlights_profile_id_fkey(id, username, display_name, bio, avatar_url, banner_accent, follower_count, created_at)",
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  const spotlights = ((data ?? []) as unknown as SpotlightRow[]).filter(
    (s): s is SpotlightRow & { profiles: NonNullable<SpotlightRow["profiles"]> } =>
      !!s.profiles && !!s.profiles.username,
  );

  const profileIds = spotlights.map((s) => s.profiles.id);

  const [decks, followingRows] = await Promise.all([
    profileIds.length === 0
      ? Promise.resolve([] as DeckRow[])
      : fetchAllPages<DeckRow>((from, to) =>
          supabase
            .from("saved_decks")
            .select("id, user_id, like_count")
            .eq("is_public", true)
            .in("user_id", profileIds)
            .order("user_id", { ascending: true })
            .range(from, to),
        ),
    viewer
      ? fetchAllPages<{ following_user_id: string }>((from, to) =>
          supabase
            .from("user_follows")
            .select("following_user_id")
            .eq("follower_user_id", viewer.id)
            .range(from, to),
        )
      : Promise.resolve([] as { following_user_id: string }[]),
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
  // A grid of nothing, for spotlighted trainers with no public battles —
  // same as the directory (see /trainers's own emptyHeat).
  const emptyHeat = buildHeatCounts([], HEAT_WEEKS);
  const following = new Set(followingRows.map((r) => r.following_user_id));

  const trainers: TrainerPreview[] = spotlights.map((s) => {
    const p = s.profiles;
    const tally = totals.get(p.id) ?? { deckCount: 0, totalLikes: 0 };
    const matchTally = statsByUser.get(p.id) ?? { matchCount: 0, winCount: 0 };
    return {
      id: p.id,
      username: p.username,
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

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)]">
        <div className="mb-6">
          <SectionHeader title="Spotlight History" />
        </div>

        {trainers.length === 0 ? (
          <div className="rounded-2xl border border-black/8 bg-white p-8 text-center text-sm text-text-secondary dark:bg-surface-elevated dark:border-white/10">
            No spotlights yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
            {trainers.map((t, i) => (
              <TrainerCard key={t.id} trainer={t} isAuthed={!!viewer} index={i} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
