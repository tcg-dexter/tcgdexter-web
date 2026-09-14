import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import shopListingsFallback from "@/data/shop-listings.json";

/**
 * eBay shop listings, resolved to the exact catalog printing they're for.
 *
 * Source of truth is the `shop_listings` table (migration
 * 20260914_shop_listings.sql), written by
 * `dexter-ops/scripts/export_shop_listings.py`. It used to live in
 * `data/shop-listings.json`, committed on every export run — and each commit
 * cost a Vercel production build. Listings are mutable state that changes
 * several times a day, so a build artifact was the wrong place for them. Card
 * metadata stays bundled: that is reference data, and a hash lookup beats a
 * query.
 *
 * The table holds two key namespaces in one flat map, exactly as the JSON did.
 * The deck profiler keys on card name (`"iono"`, `"iono:185"`) — a deck list
 * names cards, not printings. A card detail page is a specific printing, so it
 * reads the `card:` keys, which the exporter resolves against cards.db using
 * the set code and `/TTT` denominator in each listing title.
 *
 * Only single cards get a `card:` key. Lots and sealed product ("Graveler
 * 37/62 Lot of 3", an Elite Trainer Box) still reach deck pages, but a card
 * page states a price for one card and would misprice them.
 */
export interface ShopListing {
  title: string;
  cardNumber: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  listingUrl: string;
  condition: string;
  bestOffer: boolean;
  /** Cheapest shipping option costs nothing. Absent on entries written before
   *  the exporter started capturing it — treat undefined as "not known free". */
  freeShipping?: boolean;
  itemId: string;
  /** How the exporter tied this listing to a printing — "unique", "set code", … */
  matchedBy?: string;
}

/** Flat `lookup_key -> listings` map. Both namespaces share one object. */
export type ShopListingIndex = Record<string, ShopListing[]>;

/** For callers that have no listings to offer — analysis still works, the
 *  shop-matches section just comes back empty, which is already the normal
 *  outcome for the vast majority of the catalog. */
export const EMPTY_SHOP_LISTINGS: ShopListingIndex = {};

interface ShopListingRow {
  lookup_key: string;
  item_id: string;
  title: string;
  card_number: string;
  price: number | string;
  currency: string;
  image_url: string | null;
  listing_url: string;
  condition: string;
  best_offer: boolean;
  free_shipping: boolean | null;
  matched_by: string | null;
}

function rowsToIndex(rows: ShopListingRow[]): ShopListingIndex {
  const index: ShopListingIndex = {};
  for (const row of rows) {
    (index[row.lookup_key] ??= []).push({
      title: row.title,
      cardNumber: row.card_number,
      // numeric comes back as a string from PostgREST on some drivers.
      price: Number(row.price),
      currency: row.currency,
      imageUrl: row.image_url,
      listingUrl: row.listing_url,
      condition: row.condition,
      bestOffer: row.best_offer,
      ...(row.free_shipping === null ? {} : { freeShipping: row.free_shipping }),
      itemId: row.item_id,
      ...(row.matched_by === null ? {} : { matchedBy: row.matched_by }),
    });
  }
  return index;
}

/**
 * TEMPORARY safety net for the cutover.
 *
 * `data/shop-listings.json` is frozen — the exporter writes Supabase now and no
 * longer rewrites or commits it. This only fires if the table read fails or
 * comes back empty, which is the window between deploying this and the first
 * export run populating the table.
 *
 * DELETE the import, this constant and the fallback branch below — and the
 * JSON file itself — once `shop_listings` has been confirmed populated. A
 * frozen fallback that silently serves months-old prices is worse than showing
 * nothing, so this must not outlive the migration.
 */
const FALLBACK_INDEX = shopListingsFallback as ShopListingIndex;

/**
 * Whole listings map, cached across requests and deployments.
 *
 * ~400 rows, so fetching the lot and indexing in memory beats per-card queries:
 * a deck analysis looks up 60 cards at once. Fifteen minutes is well inside the
 * export cadence (7am/7pm), so a refresh is never more than one cycle stale.
 *
 * Uses the cookie-free public client deliberately — `unstable_cache` forbids
 * `cookies()`, which the SSR client calls.
 */
export const loadShopListings = unstable_cache(
  async (): Promise<ShopListingIndex> => {
    try {
      const supabase = createPublicClient();
      const { data, error } = await supabase
        .from("shop_listings")
        .select(
          "lookup_key,item_id,title,card_number,price,currency,image_url,listing_url,condition,best_offer,free_shipping,matched_by"
        );

      if (error) {
        console.error("[shopListings] query failed:", error.message);
        return FALLBACK_INDEX;
      }
      if (!data?.length) return FALLBACK_INDEX;

      return rowsToIndex(data as ShopListingRow[]);
    } catch (err) {
      console.error("[shopListings] load threw:", err);
      return FALLBACK_INDEX;
    }
  },
  ["shop-listings-index"],
  { revalidate: 900, tags: ["shop-listings"] }
);

/**
 * Listings for one printing, cheapest first. Empty for the vast majority of
 * the catalog — the shop stocks a few hundred cards against ~20,600 printings,
 * so callers should render nothing rather than an empty state.
 *
 * Matching is name + number, not variant: the shop doesn't reliably distinguish
 * a holo from a reverse holo in its titles, and a buyer looking at a printing
 * isn't filtering on that.
 */
export function shopListingsForCard(
  index: ShopListingIndex,
  setId: string,
  number: string
): ShopListing[] {
  const listings = index[`card:${setId}-${number}`];
  if (!listings?.length) return [];
  return [...listings].sort((a, b) => a.price - b.price);
}

/**
 * Listings for a deck-list card: exact printing first (`name:number`), then
 * name only. Shared by the deck profiler and the meta-deck builder so the two
 * can't drift.
 */
export function shopListingsForDeckCard(
  index: ShopListingIndex,
  name: string,
  number: string | null | undefined
): ShopListing[] {
  const nameLower = name.toLowerCase();
  const exactKey = number ? `${nameLower}:${number}` : null;
  if (exactKey && index[exactKey]) return index[exactKey];
  return index[nameLower] ?? [];
}
