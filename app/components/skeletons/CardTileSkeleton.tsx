/**
 * Tile-shaped placeholder for card grid skeletons. Matches the real grid
 * tile's aspect ratio and rounded-xl bg-surface chrome (see GridTile in
 * app/cards/CardsClient.tsx) so the swap from skeleton → real image is
 * jump-free.
 */
export default function CardTileSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        aria-hidden
        className="relative w-full rounded-xl bg-surface animate-pulse"
        style={{ aspectRatio: "245 / 342" }}
      />
    </div>
  );
}
