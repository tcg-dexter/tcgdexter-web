import { SkeletonBlock, SkeletonLine } from "@/app/components/skeletons/Skeleton";

/**
 * Card detail shell. Mirrors the layout of CardDetailPage: large card
 * image on the left, title + meta + price block on the right.
 */
export default function CardDetailLoading() {
  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] xl:pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-24">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 md:gap-10">
        <div
          aria-hidden
          className="w-full rounded-2xl bg-surface animate-pulse"
          style={{ aspectRatio: "245 / 342" }}
        />
        <div className="space-y-4">
          <SkeletonLine width="w-2/3" height="h-7" />
          <SkeletonLine width="w-1/3" height="h-3" />
          <SkeletonBlock height="h-24" className="mt-2" />
          <SkeletonBlock height="h-16" />
        </div>
      </div>
    </main>
  );
}
