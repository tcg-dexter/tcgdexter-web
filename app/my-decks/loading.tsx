import SectionHeader from "@/app/components/ui/SectionHeader";
import { SkeletonBlock, SkeletonCircle, SkeletonLine } from "@/app/components/skeletons/Skeleton";

/**
 * My Decks shell. Title + outer padding mirror MyDecksClient exactly so the
 * heading doesn't jump in size or position when the real page swaps in.
 * Card shape mirrors UserDeckCard's banner-first layout (banner, name row,
 * composition ring + legend, footer) so the swap-in doesn't shift layout.
 */
export default function MyDecksLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Deck Collection" />
      </div>

      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden mb-4 h-[170px] md:h-[220px]">
        <SkeletonBlock height="h-full" className="rounded-none" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden"
          >
            <SkeletonBlock height="h-[150px]" className="rounded-none" />
            <div className="px-3.5 pt-3 pb-1">
              <SkeletonLine width="w-2/3" height="h-4" />
            </div>
            <div className="flex items-center gap-3.5 px-3.5 pt-2.5 pb-3">
              <SkeletonCircle size="w-[58px] h-[58px]" />
              <div className="flex flex-col gap-1.5">
                <SkeletonLine width="w-20" height="h-3" />
                <SkeletonLine width="w-20" height="h-3" />
                <SkeletonLine width="w-20" height="h-3" />
              </div>
            </div>
            <div className="flex border-t border-black/5 dark:border-white/10">
              <SkeletonLine width="w-full" height="h-9" className="rounded-none" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
