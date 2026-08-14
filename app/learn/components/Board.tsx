/**
 * A labelled diagram of the play area.
 *
 * The lessons name Active, Bench, Prizes, Discard and Stadium constantly, but
 * a true beginner has never seen a table laid out — so those were free-floating
 * words. Showing the board once, early, gives every later term somewhere to live.
 *
 * Plain CSS grid rather than inline SVG: the labels stay real text (selectable,
 * translatable, readable to a screen reader in DOM order), it reflows on a
 * narrow viewport without a viewBox fight, and it inherits the theme tokens
 * directly instead of needing a parallel dark-mode fill palette.
 */

function Slot({
  label,
  className = "",
  tall = false,
  muted = false,
}: {
  label: string;
  className?: string;
  tall?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded border border-dashed px-1 text-center leading-tight ${
        tall ? "py-4 text-[11px]" : "py-2 text-[10px]"
      } ${
        muted
          ? "border-border text-text-muted"
          : "border-text-muted/60 text-text-secondary bg-surface dark:bg-surface-2"
      } ${className}`}
    >
      {label}
    </div>
  );
}

export default function Board() {
  return (
    <figure className="my-6 rounded-xl border border-border bg-surface-elevated p-3 sm:p-5">
      {/* Opponent's half — collapsed to the one slot you interact with. */}
      <Slot label="Opponent's Active Pokémon" muted tall className="mb-2" />
      <div className="mb-3 border-t border-dashed border-border" />

      <div className="grid grid-cols-[minmax(52px,1fr)_2.4fr_minmax(52px,1fr)] gap-2 sm:gap-3">
        {/* Prize cards — 6, face down, off to one side. */}
        <div>
          <div className="grid grid-cols-2 gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <Slot key={i} label="★" />
            ))}
          </div>
          <p className="mt-1 text-center text-[10px] font-semibold text-text-primary">
            Prizes (6)
          </p>
        </div>

        {/* Active + Bench. */}
        <div className="flex flex-col gap-2">
          <Slot label="Your Active Pokémon" tall />
          <div className="grid grid-cols-5 gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Slot key={i} label={`${i + 1}`} />
            ))}
          </div>
          <p className="text-center text-[10px] font-semibold text-text-primary">
            Bench (up to 5)
          </p>
        </div>

        {/* Deck and discard. */}
        <div className="flex flex-col gap-2">
          <Slot label="Deck" tall />
          <Slot label="Discard" tall />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
        <Slot label="Stadium (shared — only one in play)" muted />
        <Slot label="Lost Zone" muted />
      </div>

      <Slot label="Your hand" className="mt-2" muted />

      <figcaption className="mt-3 text-center text-xs text-text-muted">
        Your side of the table. Your opponent&rsquo;s mirrors it.
      </figcaption>
    </figure>
  );
}
