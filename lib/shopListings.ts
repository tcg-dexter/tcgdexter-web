import shopListingsData from "@/data/shop-listings.json";

/**
 * eBay shop listings, resolved to the exact catalog printing they're for.
 *
 * `data/shop-listings.json` is written by
 * `dexter-ops/scripts/export_shop_listings.py` and holds two key namespaces in
 * one flat map. The deck profiler keys on card name (`"iono"`,
 * `"iono:185"`), which is right there — a deck list names cards, not printings.
 * A card detail page is a specific printing, so it reads the `card:` keys, which
 * the exporter resolves against cards.db using the set code and `/TTT`
 * denominator in each listing title.
 *
 * Only single cards get a `card:` key. Lots and sealed product ("Graveler 37/62
 * Lot of 3", an Elite Trainer Box) still reach deck pages, but a card page
 * states a price for one card and would misprice them.
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
  itemId: string;
  /** How the exporter tied this listing to a printing — "unique", "set code", … */
  matchedBy?: string;
}

const LISTINGS = shopListingsData as Record<string, ShopListing[]>;

/**
 * Listings for one printing, cheapest first. Empty for the vast majority of
 * the catalog — the shop stocks a few hundred cards against ~20,600 printings,
 * so callers should render nothing rather than an empty state.
 *
 * Matching is name + number, not variant: the shop doesn't reliably distinguish
 * a holo from a reverse holo in its titles, and a buyer looking at a printing
 * isn't filtering on that.
 */
export function shopListingsForCard(setId: string, number: string): ShopListing[] {
  const listings = LISTINGS[`card:${setId}-${number}`];
  if (!listings?.length) return [];
  return [...listings].sort((a, b) => a.price - b.price);
}
