/**
 * Multi-select indicator shown on a card (grid tile top-left corner, or
 * the leading edge of a list row) when a catalog/list toolbar's Select
 * mode is active. Unselected: a translucent empty circle. Selected: a
 * solid black circle showing the card's 1-indexed selection order.
 */
export default function SelectionCircle({ order }: { order: number | null }) {
  if (order == null) {
    return (
      <div
        aria-hidden="true"
        className="w-6 h-6 rounded-full bg-white/50 border border-white/80 backdrop-blur-sm"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center"
    >
      {order}
    </div>
  );
}
