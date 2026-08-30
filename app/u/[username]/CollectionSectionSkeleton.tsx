import { SkeletonCard, SkeletonLine } from "@/app/components/skeletons/Skeleton";

/**
 * Placeholder held in the Collection module's slot while its two aggregates
 * resolve (see CollectionSectionAsync).
 *
 * Shaped like the EMPTY state, not the populated one, which is the opposite
 * of the usual skeleton instinct. Most profiles own nothing, and for those
 * `CollectionSection` renders a single short "No cards in your collection
 * yet" card — so a skeleton drawing a heading, four stat tiles and a chart
 * would flash a collection that isn't there and then collapse. Promising
 * less and growing into more is the safer error here, and it costs nothing
 * in layout terms because this module is the last element on the page:
 * expanding downward reflows nothing above it.
 *
 * Its own file rather than an export of CollectionSectionAsync: this is what
 * renders *first*, so colocating it with the component whose await it's
 * covering has it backwards.
 */
export default function CollectionSectionSkeleton() {
  return (
    <div className="px-4 sm:px-8 mt-6" aria-hidden>
      <div className="mb-3 px-1">
        <SkeletonLine width="w-28" height="h-5" />
      </div>
      <SkeletonCard padding="p-8">
        <SkeletonLine width="w-2/3" height="h-3" className="mx-auto" />
      </SkeletonCard>
    </div>
  );
}
