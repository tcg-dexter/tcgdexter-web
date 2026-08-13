import type { ShopListing } from "@/lib/shopListings";

/**
 * "Available in the Shop" for a single printing.
 *
 * The deck-profile version of this module is a collapsed `<details>`, because
 * there it summarises up to 60 cards and would otherwise bury the rest of the
 * analysis. Here the page is already about one card and the listings are the
 * answer to a question the reader is actively asking, so it renders open with
 * room for the seller's own photo.
 *
 * Rendered only when there's at least one listing — the shop stocks a few
 * hundred cards against ~20,600 printings, so an empty state would be the
 * overwhelmingly common case and pure noise. The heading carries no card name
 * or count for the same reason: the page states which card this is, and the
 * listings are right there to be counted.
 */
export default function ShopListingsPanel({
  listings,
}: {
  listings: ShopListing[];
}) {
  if (listings.length === 0) return null;

  return (
    <section className="mt-10 rounded-2xl p-[1.5px] bg-gradient-brand shadow-sm">
      <div className="rounded-[14.5px] bg-white/95 dark:bg-surface-elevated backdrop-blur-xl p-5">
        <h2 className="text-lg font-semibold text-text-primary">
          Available in the Shop
        </h2>

        <ul className="mt-4 flex flex-col gap-3">
          {listings.map((listing) => (
            <li key={listing.itemId} className="flex items-center gap-4">
              {listing.imageUrl && (
                /* The seller's own photo, not a catalog scan — it's the actual
                   card being sold, wear and all, which is the point. */
                <img
                  src={listing.imageUrl}
                  alt={listing.title}
                  loading="lazy"
                  className="w-16 h-16 sm:w-20 sm:h-20 object-contain rounded-lg flex-shrink-0"
                />
              )}

              <div className="flex flex-col min-w-0 flex-1 gap-1">
                <span className="text-sm text-text-secondary line-clamp-2">
                  {listing.title}
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-semibold text-text-primary">
                    ${listing.price.toFixed(2)}
                  </span>
                  {listing.freeShipping && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                      Free shipping
                    </span>
                  )}
                </div>
              </div>

              <a
                href={listing.listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-primary hover:border-accent/40 hover:text-accent transition-colors"
              >
                View
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
