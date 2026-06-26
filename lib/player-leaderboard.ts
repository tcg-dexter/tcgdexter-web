import { createAdminClient } from "@/lib/supabase/admin";

export interface LeaderboardPlayer {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  /** wins / (wins + losses) as a percentage; null when no decisive games. */
  winPct: number | null;
}

const PAGE = 1000;
const MAX_MATCH_PAGES = 60; // safety cap: 60k match rows

/**
 * Aggregate a public-player leaderboard: every public profile that has
 * recorded matches on their public decks, with total wins/losses and win
 * percentage. "Public" mirrors the recent-matches definition — a public
 * profile owning public saved_decks. Uses the admin client to aggregate
 * across users (match rows are otherwise RLS-scoped to their owner).
 */
export async function loadPlayerLeaderboard(): Promise<LeaderboardPlayer[]> {
  try {
    const admin = createAdminClient();

    // 1. Public profiles with a username — the candidate players.
    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("is_public", true)
      .not("username", "is", null);
    if (profErr || !profiles?.length) return [];

    const profById = new Map(profiles.map((p) => [p.id as string, p]));

    // 2. Public decks owned by those profiles → deck_id → owner_id. Page
    //    through so collections beyond db.maxRows don't silently truncate.
    const deckOwner = new Map<string, string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("saved_decks")
        .select("id, user_id")
        .eq("is_public", true)
        .range(from, from + PAGE - 1);
      if (error) break;
      if (!data?.length) break;
      for (const d of data) {
        if (profById.has(d.user_id as string)) {
          deckOwner.set(d.id as string, d.user_id as string);
        }
      }
      if (data.length < PAGE) break;
    }
    if (deckOwner.size === 0) return [];

    // 3. Tally match results per owner, counting only matches on a public
    //    deck of a public profile. Page through the matches table.
    const tally = new Map<string, { w: number; l: number; d: number }>();
    for (let p = 0; p < MAX_MATCH_PAGES; p++) {
      const from = p * PAGE;
      const { data, error } = await admin
        .from("matches")
        .select("saved_deck_id, result")
        .range(from, from + PAGE - 1);
      if (error) break;
      if (!data?.length) break;
      for (const m of data) {
        const owner = deckOwner.get(m.saved_deck_id as string);
        if (!owner) continue;
        const t = tally.get(owner) ?? { w: 0, l: 0, d: 0 };
        if (m.result === "win") t.w++;
        else if (m.result === "loss") t.l++;
        else if (m.result === "draw") t.d++;
        tally.set(owner, t);
      }
      if (data.length < PAGE) break;
    }

    const rows: LeaderboardPlayer[] = [];
    tally.forEach((t, ownerId) => {
      const p = profById.get(ownerId);
      const username = p?.username as string | undefined;
      if (!username) return;
      const games = t.w + t.l + t.d;
      if (games === 0) return;
      const decisive = t.w + t.l;
      rows.push({
        username,
        displayName: (p?.display_name as string) || username,
        avatarUrl: (p?.avatar_url as string | null) ?? null,
        wins: t.w,
        losses: t.l,
        draws: t.d,
        games,
        winPct: decisive > 0 ? (t.w / decisive) * 100 : null,
      });
    });

    // Leaderboard order: most wins first, then win %, then most games.
    rows.sort(
      (a, b) =>
        b.wins - a.wins ||
        (b.winPct ?? -1) - (a.winPct ?? -1) ||
        b.games - a.games,
    );

    return rows;
  } catch (err) {
    console.error("[player-leaderboard] failed:", err);
    return [];
  }
}
