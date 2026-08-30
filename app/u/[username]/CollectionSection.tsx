import Link from "next/link";
import PriceHistoryChart from "@/app/cards/[id]/PriceHistoryChart";
import { StatCard, ResponsiveLabel } from "@/app/components/StatCard";
import type { CollectionStats } from "@/lib/collection";
import type { PricePoint } from "@/lib/priceHistory";

/** Compact currency for the value tile — a five-figure collection would
 *  otherwise wrap the tile's single line. Cents only matter below $1k. */
function formatValue(n: number): string {
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

interface Props {
  stats: CollectionStats;
  valueHistory: PricePoint[];
  isOwner: boolean;
  /** Owner's opt-in state. Only read when isOwner — it drives the
   *  "Private" badge that tells them why visitors can't see this. */
  collectionPublic: boolean;
  /** Banner accent gradient, so the value tile matches the Wins tile at
   *  the top of the same page. */
  gradientCss: string;
}

/**
 * The Collection module — bottom section of a user profile page.
 *
 * Deliberately a summary, not a browser: stats plus the aggregate value
 * curve, with a link out to the real thing. The card catalog already is the
 * collection browser (its Owned filter scopes the whole catalog to what you
 * have), so embedding a second grid of card tiles here would be a worse
 * copy of a page that already exists.
 *
 * "View Collection" is owner-only on purpose. The catalog's ownership
 * filter resolves against whoever is *viewing* it, so on a visitor's screen
 * that link would quietly show them their own cards under someone else's
 * name. There's no route that browses another user's collection, so
 * visitors get the summary alone.
 */
export default function CollectionSection({
  stats,
  valueHistory,
  isOwner,
  collectionPublic,
  gradientCss,
}: Props) {
  const isEmpty = stats.totalCards === 0;

  return (
    <div className="px-4 sm:px-8 mt-6">
      <div className="mb-3 px-1 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">
          Collection
          {!isEmpty && (
            <span className="ml-2 text-sm font-normal text-text-muted">
              ({stats.totalCards.toLocaleString()})
            </span>
          )}
          {isOwner && !collectionPublic && (
            // Mirrors the "Private" affordance on unlisted decks: the owner
            // sees this module either way, so without a marker there's no
            // way to tell from the page whether visitors can see it too.
            <span className="ml-2 align-middle rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-text-muted">
              Private
            </span>
          )}
        </h2>
        {isOwner && !isEmpty && (
          <Link
            href="/cards?ownership=owned"
            className="shrink-0 text-xs font-semibold text-accent hover:underline"
          >
            View Collection →
          </Link>
        )}
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
          <p className="text-sm text-text-secondary">
            {isOwner ? (
              <>
                No cards in your collection yet.{" "}
                <Link href="/cards" className="text-accent hover:underline">
                  Add some from Card Catalog →
                </Link>
              </>
            ) : (
              "Nothing in this collection yet."
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label={<ResponsiveLabel mobile="Value" desktop="Total Value" />}
              value={formatValue(stats.totalValue)}
              tone="gradient"
              gradientCss={gradientCss}
            />
            <StatCard label="Cards" value={stats.totalCards.toLocaleString()} />
            <StatCard label="Unique" value={stats.uniqueCards.toLocaleString()} />
            <StatCard label="Sets" value={stats.totalSets.toLocaleString()} />
          </div>

          {/* Renders nothing below two data points — a collection newer than
              the price-history backfill has no curve to draw yet. */}
          <PriceHistoryChart
            points={valueHistory}
            title="Collection Value"
            className=""
          />
        </div>
      )}
    </div>
  );
}
