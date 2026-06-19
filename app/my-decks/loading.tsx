import SectionHeader from "@/app/components/ui/SectionHeader";
import { SkeletonBlock, SkeletonLine } from "@/app/components/skeletons/Skeleton";

/**
 * My Decks shell. Title + outer padding mirror MyDecksClient exactly so the
 * heading doesn't jump in size or position when the real page swaps in.
 */
export default function MyDecksLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Deck Collection" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden"
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
    </main>
  );
}
