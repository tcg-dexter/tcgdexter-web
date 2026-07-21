import CardTileSkeleton from "@/app/components/skeletons/CardTileSkeleton";
import SectionHeader from "@/app/components/ui/SectionHeader";

/**
 * Card Catalog shell. Header + toolbar-shaped placeholder + a 60-tile grid
 * matching the real grid at CardsClient.GridView. Renders instantly on
 * navigation; the server component swaps in once searchCards() resolves.
 */
export default function CardsLoading() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6">
        <SectionHeader title="Card Catalog" />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="flex-1 h-[38px] rounded-full bg-black/5 dark:bg-white/10 animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-[38px] w-40 rounded-full bg-black/5 dark:bg-white/10 animate-pulse" />
          <div className="h-[38px] w-20 rounded-full bg-black/5 dark:bg-white/10 animate-pulse" />
          <div className="h-[38px] w-28 rounded-full bg-black/5 dark:bg-white/10 animate-pulse" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {Array.from({ length: 60 }).map((_, i) => (
          <CardTileSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
