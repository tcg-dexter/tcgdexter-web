import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCardById } from "@/lib/cardsIndex";
import { fetchAllPages } from "@/lib/trainerActivity";
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
 * expressed on the app side; `collection_value_history()` re-checks the
 * same rule in SQL, because it runs SECURITY DEFINER and so can't take the
 * caller's word for it.
 *
 * ── Why the admin client ──
 * `user_card_collection` is owner-only under RLS
 * (user_card_collection_owner_select), so the anon/session client returns
 * nothing at all when a visitor looks at someone else's public collection.
 * Reading it through the service-role client is the same approach
 * lib/trainerActivity.ts already takes for `matches` on the public trainer
 * directory. Every caller here is gated on canViewCollection first.
 */

/** One row of a user's collection. */
interface CollectionRow {
  set_id: string;
  number: string;
  quantity: number;
}

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
 * Value is summed against the bundled card index rather than
 * `card_price_history`'s latest row, so the total always reconciles with the
 * per-card prices the catalog shows — two different sources would let the
 * module disagree with the cards it links out to.
 *
 * A printing the index can't resolve (an unreleased set the bundle predates)
 * still counts toward totalCards/uniqueCards/totalSets and contributes 0 to
 * value: dropping it from the counts too would understate the collection,
 * which is the more visible error of the two.
 */
export async function loadCollectionStats(userId: string): Promise<CollectionStats> {
  // Same guard as loadPublicBattleActivity: the service-role key is absent
  // in some environments, and createAdminClient throws rather than silently
  // falling back to anon. Zeroed stats degrade the module to its empty
  // state; letting this throw would take the whole profile page down.
  let rows: CollectionRow[];
  try {
    const admin = createAdminClient();
    rows = await fetchAllPages<CollectionRow>((from, to) =>
      admin
        .from("user_card_collection")
        .select("set_id, number, quantity")
        .eq("user_id", userId)
        .gt("quantity", 0)
        .order("set_id")
        .order("number")
        .range(from, to)
        .then(({ data }) => ({ data: (data ?? []) as CollectionRow[] })),
    );
  } catch (e) {
    console.error("[collection] stats unavailable:", e);
    return EMPTY_COLLECTION_STATS;
  }

  const printings = new Set<string>();
  const sets = new Set<string>();
  let totalCards = 0;
  let totalValue = 0;

  for (const row of rows) {
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) continue;
    totalCards += qty;
    printings.add(`${row.set_id}-${row.number}`);
    sets.add(row.set_id);
    const card = getCardById(`${row.set_id}-${row.number}`);
    if (card) totalValue += card.marketPrice * qty;
  }

  return {
    totalCards,
    uniqueCards: printings.size,
    totalSets: sets.size,
    totalValue,
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
 * Called through the session client, not the admin client — the function is
 * SECURITY DEFINER and reads `auth.uid()` to recognise the owner, which is
 * only populated on a client carrying the user's session.
 */
export async function loadCollectionValueHistory(
  userId: string,
  days = 90,
): Promise<PricePoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collection_value_history", {
    target: userId,
    days,
  });

  if (error || !data) {
    if (error) console.error("[collection] value history failed:", error);
    return [];
  }

  return (data as Array<{ date: string; value: number | string }>).map((row) => ({
    date: row.date,
    price: Number(row.value),
  }));
}
