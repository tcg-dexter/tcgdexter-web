import { createAdminClient } from "@/lib/supabase/admin";
import { buildHeatCounts, type BattleRow } from "@/app/profile/BattleHeatMap";

/**
 * Shared server-side plumbing for any page that renders TrainerCard/TrainerRow
 * previews built from real `matches` data — today that's the /trainers
 * directory and the /spotlight archive. Kept in one place because the
 * privacy boundary here (public decks only, never a trainer's full private
 * history) is easy to get subtly wrong if reimplemented per page.
 */

/**
 * Weeks in a preview card's activity grid. Shorter than the profile module's
 * 20 — the grid sits in the card's identity row, pinned to a fixed height
 * (see HEAT_HEIGHT_PX in TrainerCard), so more weeks only ever means a wider
 * grid squeezing the name column, never a taller one. 12 is chosen to leave
 * the name enough room at the card's narrowest (single-column mobile) width.
 *
 * Lives here rather than in TrainerCard.tsx (a "use client" module) because a
 * plain constant imported from a client module into a server component is
 * NOT the value — it's a client reference. That mistake shipped once: the
 * card (rendered inside the client graph, where the constant is real) drew a
 * 7-column template, while the server page building its data (across the
 * boundary, where it isn't) built zero cells to put in it. BattleHeatGrid
 * derives its own column count from the counts it's given, so this number
 * only has to be right in the server module(s) that build those counts.
 */
export const HEAT_WEEKS = 12;

export interface DeckRow {
  id: string;
  user_id: string;
  like_count: number | null;
}

/** Per-user tallies for a card footer's Matches / Wins stats — same
 *  public-deck scope as the activity grid (see loadPublicBattleActivity). */
export interface MatchTally {
  matchCount: number;
  winCount: number;
}

/** PostgREST caps a single response at db.maxRows (default 1000). Tables
 *  read here can cross that line as the app grows, and a silent truncation
 *  would show up as trainers with wrong-looking (or zero) counts rather
 *  than as an error — so page through explicitly, same shape as the card
 *  catalog's ownership fetch. */
const PAGE = 1000;
export async function fetchAllPages<T>(
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
 * Per-user battle activity for trainer preview cards: the mini heat grids
 * AND the footer's Matches / Wins counts, built from one shared query.
 *
 * ── What this deliberately does and doesn't show ──
 * Only battles attached to a PUBLIC deck of a public profile. That's the
 * same boundary `loadRecentBattles` draws for the /battles feed, where
 * these battles already appear by handle with their own public pages — so
 * nothing here is visible that wasn't already.
 *
 * It is NOT the same set the profile page's heat map draws, which is the
 * owner's full history including private decks and is shown to the owner
 * alone (see the `isOwner &&` guard there). A trainer's card here will
 * therefore look quieter than their own profile does to them, which is the
 * correct direction for the difference to run — including Matches / Wins: a
 * lower count here than the owner's own profile shows is expected, not a bug.
 *
 * Needs the service-role client because `matches` is owner-only under RLS
 * — the RLS client would return an empty set for every trainer but the
 * viewer. If that client can't be built (the key is server-only and absent
 * in some environments) both the grids and the stats render empty rather
 * than the page failing: activity is decoration here, not the point of the
 * surface.
 */
export async function loadPublicBattleActivity(
  decks: DeckRow[],
  heatWeeks: number = HEAT_WEEKS,
): Promise<{ heatByUser: Map<string, number[]>; statsByUser: Map<string, MatchTally> }> {
  const heatByUser = new Map<string, number[]>();
  const statsByUser = new Map<string, MatchTally>();
  if (!decks.length) return { heatByUser, statsByUser };

  const userByDeck = new Map(decks.map((d) => [d.id, d.user_id]));

  // Derived from heatWeeks, never a literal: a window that doesn't grow
  // with the grid leaves its leftmost columns permanently empty, which
  // looks like "this trainer wasn't playing then" rather than like a bug.
  // One week of slack because the grid starts at the SUNDAY of the oldest
  // week, up to six days earlier than "heatWeeks * 7 days ago".
  const since = new Date();
  since.setDate(since.getDate() - (heatWeeks + 1) * 7);
  const sinceIso = since.toISOString();

  let heatRows: Array<BattleRow & { saved_deck_id: string | null }>;
  // Matches/Wins are a lifetime tally, unlike the heat grid's rolling
  // window — a separate, unbounded query rather than reusing heatRows.
  let statRows: Array<{ saved_deck_id: string | null; result: string }>;
  try {
    const admin = createAdminClient();
    [heatRows, statRows] = await Promise.all([
      fetchAllPages((from, to) =>
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
      ),
      fetchAllPages((from, to) =>
        admin
          .from("matches")
          .select("saved_deck_id, result")
          .not("saved_deck_id", "is", null)
          .range(from, to),
      ),
    ]);
  } catch (err) {
    console.error("[trainerActivity] battle activity unavailable:", err);
    return { heatByUser, statsByUser };
  }

  const heatByUserRows = new Map<string, BattleRow[]>();
  for (const r of heatRows) {
    const userId = r.saved_deck_id ? userByDeck.get(r.saved_deck_id) : undefined;
    if (!userId) continue; // private deck, or a deck whose owner isn't public
    const list = heatByUserRows.get(userId);
    if (list) list.push(r);
    else heatByUserRows.set(userId, [r]);
  }
  // forEach rather than for..of: the tsconfig target predates iterating a
  // Map directly, and this file has no reason to be the one that changes it.
  heatByUserRows.forEach((battles, userId) => {
    heatByUser.set(userId, buildHeatCounts(battles, heatWeeks));
  });

  for (const r of statRows) {
    const userId = r.saved_deck_id ? userByDeck.get(r.saved_deck_id) : undefined;
    if (!userId) continue;
    const tally = statsByUser.get(userId) ?? { matchCount: 0, winCount: 0 };
    tally.matchCount += 1;
    if (r.result === "win") tally.winCount += 1;
    statsByUser.set(userId, tally);
  }

  return { heatByUser, statsByUser };
}
