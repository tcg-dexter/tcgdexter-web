import type { SupabaseClient } from "@supabase/supabase-js";
import cardData from "@/data/cards-standard.json";

interface CardDataEntry {
  set_id: string;
  number: string;
  market_price: number | null;
}

let PRICE_INDEX: Map<string, number> | null = null;

function buildPriceIndex(): Map<string, number> {
  const idx = new Map<string, number>();
  const db = cardData as unknown as Record<string, CardDataEntry[]>;
  for (const entries of Object.values(db)) {
    for (const e of entries) {
      if (e.market_price == null || e.market_price <= 0) continue;
      idx.set(`${e.set_id}|${e.number}`, e.market_price);
    }
  }
  return idx;
}

function priceIndex(): Map<string, number> {
  if (!PRICE_INDEX) PRICE_INDEX = buildPriceIndex();
  return PRICE_INDEX;
}

/**
 * NOTE: this paging-and-summing approach is kept only for the Sets data view
 * (`app/api/collection/data-view/route.ts`), which needs `uniqueOwnedBySet`
 * — a per-set breakdown that has to walk the rows anyway.
 *
 * For plain headline totals, use the `collection_stats()` SQL function
 * instead (lib/collection.ts → loadCollectionStats, migration
 * 20260830_collection_stats.sql). It returns one row rather than paging the
 * whole collection, and its value figure matches the profile module's chart.
 * Please don't add a third copy of this loop.
 */
export interface CollectionStats {
  cardCount: number;
  marketValue: number;
}

export interface CollectionDataViewStats extends CollectionStats {
  /** Distinct (set_id, number) cards owned in each set. Keyed by set_id;
   *  variant rows for the same printing collapse to a single entry. */
  uniqueOwnedBySet: Record<string, number>;
}

const PAGE = 1000;

export async function computeCollectionStats(
  supabase: SupabaseClient,
  userId: string
): Promise<CollectionStats> {
  const prices = priceIndex();
  let cardCount = 0;
  let marketValue = 0;
  let from = 0;
  // Supabase capped at 1000 rows per request; paginate to cover full collection.
  for (;;) {
    const { data, error } = await supabase
      .from("user_card_collection")
      .select("set_id, number, quantity")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data as Array<{ set_id: string; number: string; quantity: number }>) {
      cardCount += row.quantity;
      const price = prices.get(`${row.set_id}|${row.number}`);
      if (price) marketValue += price * row.quantity;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { cardCount, marketValue: Math.round(marketValue * 100) / 100 };
}

export async function computeCollectionDataViewStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<CollectionDataViewStats> {
  const prices = priceIndex();
  let cardCount = 0;
  let marketValue = 0;
  const uniquePerSet = new Map<string, Set<string>>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("user_card_collection")
      .select("set_id, number, quantity")
      .eq("user_id", userId)
      .gt("quantity", 0)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const row of data as Array<{ set_id: string; number: string; quantity: number }>) {
      cardCount += row.quantity;
      const price = prices.get(`${row.set_id}|${row.number}`);
      if (price) marketValue += price * row.quantity;
      let bucket = uniquePerSet.get(row.set_id);
      if (!bucket) {
        bucket = new Set<string>();
        uniquePerSet.set(row.set_id, bucket);
      }
      bucket.add(row.number);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const uniqueOwnedBySet: Record<string, number> = {};
  uniquePerSet.forEach((nums, setId) => {
    uniqueOwnedBySet[setId] = nums.size;
  });
  return {
    cardCount,
    marketValue: Math.round(marketValue * 100) / 100,
    uniqueOwnedBySet,
  };
}
