import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UserDeckCard } from "@/app/components/DeckPostCard";
import { primaryCardImageUrl } from "@/lib/primaryCardImage";
// Note: the global UnifiedSearch (./UnifiedSearch) used to live here in the
// page header. It now ships in the site chrome — desktop right sidebar +
// mobile nav panel footer — so it's reachable from every route, not just
// /leaderboard.

export const revalidate = 300; // 5-minute cache

interface ProfileRow {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
}

interface DeckRow {
  user_id: string;
  like_count: number;
}

interface TopDeck {
  id: string;
  short_id: string;
  name: string;
  like_count: number;
  user_id: string;
  analysis: {
    deckPrice?: number;
    metaMatch?: { archetypeName?: string | null; archetypeId?: string | null };
    rotation?: { ready?: boolean };
    sections?: { pokemon: number; trainer: number; energy: number };
    cards?: Array<{ qty: number; name: string; number: string; setCode: string; section: "pokemon" | "trainer" | "energy" }>;
  } | null;
  cover_image_url: string | null;
  username: string;
  display_name: string;
}

async function fetchLeaderboard(): Promise<Array<ProfileRow & { totalLikes: number; deckCount: number }>> {
  const supabase = await createClient();

  // Fetch all public decks (minimal columns) — RLS enforces is_public + owner is_public
  const { data: decks } = await supabase
    .from("saved_decks")
    .select("user_id, like_count")
    .eq("is_public", true);

  if (!decks?.length) return [];

  // Aggregate per user
  const totals = new Map<string, { totalLikes: number; deckCount: number }>();
  for (const d of decks as DeckRow[]) {
    const prev = totals.get(d.user_id) ?? { totalLikes: 0, deckCount: 0 };
    totals.set(d.user_id, {
      totalLikes: prev.totalLikes + (d.like_count ?? 0),
      deckCount: prev.deckCount + 1,
    });
  }

  // Top 20 by likes
  const topIds = Array.from(totals.entries())
    .sort((a, b) => b[1].totalLikes - a[1].totalLikes)
    .slice(0, 20)
    .map(([id]) => id);

  if (!topIds.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", topIds)
    .eq("is_public", true)
    .not("username", "is", null);

  if (!profiles?.length) return [];

  return (profiles as ProfileRow[])
    .map((p) => ({ ...p, ...(totals.get(p.id) ?? { totalLikes: 0, deckCount: 0 }) }))
    .sort((a, b) => b.totalLikes - a.totalLikes);
}

async function fetchTopDecks(): Promise<TopDeck[]> {
  const supabase = await createClient();

  // RLS already enforces is_public + owner profile is_public
  const { data: decks } = await supabase
    .from("saved_decks")
    .select("id, short_id, name, like_count, user_id, analysis, cover_image_url")
    .eq("is_public", true)
    .order("like_count", { ascending: false })
    .limit(10);

  if (!decks?.length) return [];

  const userIds = Array.from(new Set(decks.map((d) => d.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .in("id", userIds)
    .eq("is_public", true)
    .not("username", "is", null);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  return decks
    .map((d) => {
      const profile = profileMap.get(d.user_id);
      if (!profile) return null;
      return { ...d, username: profile.username, display_name: profile.display_name };
    })
    .filter(Boolean) as TopDeck[];
}

export default async function LeaderboardPage() {
  const [trainers, topDecks] = await Promise.all([fetchLeaderboard(), fetchTopDecks()]);
  const top3 = trainers.slice(0, 3);

  const rankMedal = ["🥇", "🥈", "🥉"];

  return (
    <main className="mx-auto max-w-6xl px-6 pt-10 pb-32">
      {/* Header */}
      <div className="mb-8">
        <div className="text-xs uppercase tracking-widest text-accent mb-3 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#ff8a3d] opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff8a3d]" />
          </span>
          Live leaderboard
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">Top Trainers</h1>
        <p className="mt-3 text-base text-text-secondary max-w-lg">
          Ranked by total deck likes. Find established players and browse their public collections.
        </p>
      </div>

      {/* Top 3 list */}
      {top3.length > 0 && (
        <div className="rounded-xl border border-black/8 bg-white shadow-sm overflow-hidden mb-8 dark:bg-surface-elevated dark:border-white/10">
          {top3.map((trainer, i) => {
            const initial = trainer.display_name.trim().charAt(0).toUpperCase();
            return (
              <Link
                key={trainer.id}
                href={`/u/${trainer.username}`}
                className="flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02] transition border-b border-black/5 last:border-b-0 dark:border-white/10"
              >
                <span className="text-xl w-7 flex-shrink-0">{rankMedal[i]}</span>
                {trainer.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={trainer.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-sm font-bold text-text-secondary flex-shrink-0">
                    {initial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary truncate">{trainer.display_name}</div>
                  <div className="text-xs text-text-muted truncate">@{trainer.username}</div>
                </div>
                <div className="text-xs text-text-muted flex-shrink-0">
                  <span className="font-semibold tabular-nums text-text-primary">{trainer.totalLikes}</span> likes
                  {" · "}
                  <span className="font-semibold tabular-nums text-text-primary">{trainer.deckCount}</span> decks
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {trainers.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <div className="text-4xl mb-4">🏆</div>
          <p className="text-sm">No public decks yet. Be the first to share yours!</p>
        </div>
      )}

      {/* Top Decks */}
      {topDecks.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
            <span className="text-sm font-semibold text-text-muted">Top decks</span>
            <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topDecks.map((deck) => {
              const price = deck.analysis?.deckPrice ?? null;
              const sections = deck.analysis?.sections ?? null;
              const imageUrl =
                deck.cover_image_url ??
                primaryCardImageUrl(deck.analysis?.cards ?? []);
              return (
                <UserDeckCard
                  key={deck.id}
                  id={deck.id}
                  name={deck.name}
                  href={`/u/${deck.username}/${deck.short_id}`}
                  username={deck.username}
                  displayName={deck.display_name}
                  price={price}
                  counts={sections}
                  likeCount={deck.like_count}
                  imageUrl={imageUrl}
                  ownerUserId={deck.user_id}
                />
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
