import { SkeletonBlock, SkeletonLine, SkeletonRow } from "./Skeleton";

/**
 * Mirrors the structure of /leaderboard:
 *   - Top 3 trainers in a card (single-column row list)
 *   - Divider with "Top decks" label
 *   - Top decks as a 3-column grid of card-shaped placeholders
 * Header is rendered as real chrome by the loading.tsx, so this only fills
 * the data-driven sections.
 */
export default function LeaderboardSkeleton() {
  return (
    <>
      <div className="rounded-xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated shadow-sm overflow-hidden mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={i < 2 ? "border-b border-black/5 dark:border-white/10" : ""}>
            <SkeletonRow />
          </div>
        ))}
      </div>

      <div className="mt-12">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
          <span className="text-sm font-semibold text-text-muted">Top decks</span>
          <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden"
            >
              <SkeletonBlock height="h-40" className="rounded-none" />
              <div className="p-4 space-y-3">
                <SkeletonLine width="w-2/3" height="h-4" />
                <SkeletonLine width="w-1/3" height="h-3" />
                <div className="flex gap-2 pt-2">
                  <SkeletonLine width="w-12" height="h-3" />
                  <SkeletonLine width="w-12" height="h-3" />
                  <SkeletonLine width="w-12" height="h-3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
