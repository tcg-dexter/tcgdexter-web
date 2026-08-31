import { createClient } from "@/lib/supabase/server";
import type { PricePoint } from "@/lib/priceHistory";

/**
 * Data behind the Collection module at the bottom of user profile pages.
 *
 * ── Visibility ──
 * The owner always sees their own module. Everyone else sees it only when
 * the profile is public AND the owner has switched on `collection_public`
 * — a deliberately separate opt-in from `is_public`, since what someone
 * owns (and what it's worth) is a different disclosure from which decks
 * they've shared. `canViewCollection` is the single place that rule is
 * expressed on the app side; both SQL functions below re-check the same
 * rule themselves, because they run SECURITY DEFINER over an owner-only
 * table and so can't take the caller's word for it.
 *
 * ── Why the session client, never the admin client ──
 * Both functions recognise the owner via `auth.uid()`, which is NULL under
 * the service-role client. Reading them through `createAdminClient()` would
 * therefore return *nothing* for an owner viewing their own still-private
 * collection — silently, and only in the one case least likely to be
 * covered by a spot check. `createClient()` from @/lib/supabase/server
 * carries the session, so it stays the only client used here.
 *
 * ── Why both are RPCs ──
 * The app-side shape of either query is enormous relative to its answer: the
 * stats are four numbers derived from every row of a collection (2,216 rows
 * for the largest real one), and the history is one row per owned printing
 * per day. Both aggregate in Postgres and return what's actually rendered.
 */

export interface CollectionStats {
  /** Every copy, including duplicates and multiple variants of a printing. */
  totalCards: number;
  /** Distinct printings, counting a card owned in three finishes once. */
  uniqueCards: number;
  /** Distinct sets those printings come from. */
  totalSets: number;
  /** Summed market value of every copy, in USD. */
  totalValue: number;
}

/** A collection that really is empty — distinct from `null`, which means the
 *  stats couldn't be loaded at all. See loadCollectionStats. */
export const EMPTY_COLLECTION_STATS: CollectionStats = {
  totalCards: 0,
  uniqueCards: 0,
  totalSets: 0,
  totalValue: 0,
};

/**
 * The module's visibility rule, in one place. `isOwner` short-circuits the
 * two profile flags so an owner can always see (and sanity-check) their own
 * collection while it's still private.
 */
export function canViewCollection({
  isOwner,
  profileIsPublic,
  collectionPublic,
}: {
  isOwner: boolean;
  profileIsPublic: boolean;
  collectionPublic: boolean;
}): boolean {
  return isOwner || (profileIsPublic && collectionPublic);
}

/**
 * Headline counts plus total market value.
 *
 * Delegates to `collection_stats()` (see 20260830_collection_stats.sql).
 * This used to page every collection row over the wire and reduce them here
 * — 2,216 rows across three round trips for the largest real collection, to
 * produce four numbers.
 *
 * Value comes from `card_price_history`'s latest row per card — the same
 * table the chart beside it is drawn from, rather than the bundled card
 * index, so the two agree in source and method. Not bit-identical, though:
 * this takes each card's own most recent priced date, while the chart groups
 * by a shared date, so on a day the price pipeline has only partly written
 * they can differ slightly.
 *
 * A printing missing from price history contributes 0 to value but still
 * counts toward cards/unique/sets — understating the value is less visible
 * than dropping the card from the counts.
 *
 * Returns `null` when the stats can't be loaded, which the caller renders as
 * "no module" rather than as an empty collection. The distinction matters: a
 * zeroed result reads as `totalCards === 0`, which is the same shape as
 * genuinely owning nothing, so a failure would tell someone with thousands
 * of cards that their collection is empty — and hide the value chart with
 * it. The realistic trigger is a deploy landing ahead of its migration, or
 * PostgREST not having reloaded its schema cache, both of which resolve on
 * their own; showing nothing until they do is honest, claiming an empty
 * collection is not.
 */
export async function loadCollectionStats(
  userId: string,
): Promise<CollectionStats | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_stats", {
    target: userId,
  });

  if (error) {
    console.error("[collection] stats failed:", error);
    return null;
  }

  // A set-returning function comes back as an array; the aggregate always
  // yields exactly one row, and none at all if the visibility gate closed.
  const row = (
    data as Array<{
      total_cards: number | string;
      unique_cards: number | string;
      total_sets: number | string;
      total_value: number | string;
    }> | null
  )?.[0];
  if (!row) return EMPTY_COLLECTION_STATS;

  // bigint and numeric both arrive as strings over PostgREST.
  return {
    totalCards: Number(row.total_cards) || 0,
    uniqueCards: Number(row.unique_cards) || 0,
    totalSets: Number(row.total_sets) || 0,
    totalValue: Number(row.total_value) || 0,
  };
}

/**
 * Daily total value of the collection over the last `days` days.
 *
 * Delegates the join and the sum to `collection_value_history()` (see
 * 20260830_collection_module.sql): the app-side shape is one row per owned
 * printing per day, which for a 2,000-printing collection is ~180k rows
 * fetched just to add them up. The function returns one row per day.
 *
 * Called through the session client, not the admin client — see the note at
 * the top of this file.
 *
 * Returns `null` when the query FAILED, distinct from `[]` for a collection
 * that genuinely has no priced history yet. The caller renders those two
 * differently, and the difference is not academic: this query is the one
 * that timed out under load (57014), and because both outcomes used to
 * collapse to `[]` — which PriceHistoryChart draws as nothing — a real
 * failure was pixel-identical to "no data". Diagnosing one such incident
 * took two wrong theories and a trip through the runtime logs.
 */
export async function loadCollectionValueHistory(
  userId: string,
  days = 90,
): Promise<PricePoint[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_value_history", {
    target: userId,
    days,
  });

  // Keep this log: it is what finally identified the statement timeout,
  // and it is still the only place the Postgres error code surfaces.
  if (error) {
    console.error("[collection] value history failed:", error);
    return null;
  }
  if (!data) return [];

  return (data as Array<{ date: string; value: number | string }>).map((row) => ({
    date: row.date,
    price: Number(row.value),
  }));
}
