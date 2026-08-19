/**
 * A labelled diagram of the play area.
 *
 * The lessons name Active, Bench, Prizes, Discard and Stadium constantly, but
 * a true beginner has never seen a table laid out — so those were free-floating
 * words. Showing the board once, early, gives every later term somewhere to live.
 *
 * The regions are laid out to match the replay playmat (`PlayerMat` in
 * `app/admin-tools/replay/BoardKit.tsx`), so a learner who finishes the
 * curriculum and opens a replay is looking at a board they already know:
 *
 *   - two mats stacked, Active Pokémon facing each other across the middle
 *   - your mat: Prizes on the left rail, Deck over Discard on the right rail,
 *     Bench along the outer edge, hand below the mat
 *   - the opponent's mat is the mirror image — rails swapped, Bench on their
 *     outer (top) edge
 *   - Stadium and the just-played Trainer flank the Active, as they do there
 *
 * Plain CSS grid rather than inline SVG: the labels stay real text (selectable,
 * translatable, readable to a screen reader in DOM order), it reflows on a
 * narrow viewport without a viewBox fight, and it inherits the theme tokens
 * directly instead of needing a parallel dark-mode fill palette.
 */

function Slot({
  label,
  sub,
  className = "",
  tall = false,
  muted = false,
}: {
  label: string;
  sub?: string;
  className?: string;
  tall?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 rounded border border-dashed px-1 text-center leading-tight ${
        tall ? "py-4 text-[11px]" : "py-2 text-[10px]"
      } ${
        muted
          ? "border-border text-text-muted"
          : "border-text-muted/60 text-text-secondary bg-surface dark:bg-surface-2"
      } ${className}`}
    >
      <span>{label}</span>
      {sub && <span className="text-[9px] text-text-muted">{sub}</span>}
    </div>
  );
}

function BenchRow({ muted = false }: { muted?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1 sm:gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        // The opponent's Bench is context, not something the lesson counts
        // off — leaving those slots unnumbered keeps the eye on your own row.
        <Slot key={i} label={muted ? "" : `${i + 1}`} muted={muted} />
      ))}
    </div>
  );
}

/**
 * One mat. `side="you"` is the near mat (Active at the top edge, Bench along
 * the bottom); `side="opponent"` is its mirror, so the two Actives end up
 * adjacent across the divider — exactly how the replay viewer stacks them.
 */
function Mat({ side }: { side: "you" | "opponent" }) {
  const you = side === "you";
  const dim = !you;

  const prizes = <Slot key="prizes" label="Prizes" sub="6, face down" muted={dim} />;
  const deck = <Slot key="deck" label="Deck" muted={dim} />;
  const discard = <Slot key="discard" label="Discard" muted={dim} />;

  // Rails swap sides between the two mats, same as the mat is a mirror.
  const leftRail = you ? [prizes] : [discard, deck];
  const rightRail = you ? [deck, discard] : [prizes];

  const activeRow = (
    <div className="grid grid-cols-[minmax(40px,0.85fr)_2.6fr_minmax(40px,0.85fr)] gap-1 sm:gap-2">
      <div className={`flex flex-col gap-1 sm:gap-2 ${you ? "" : "justify-end"}`}>
        {leftRail}
      </div>

      {/* Centre column: the Active, flanked by the two cards that float
          beside it on the mat rather than living in a rail. */}
      <div className="grid grid-cols-[0.8fr_1.4fr_0.8fr] items-center gap-1 sm:gap-2">
        {you ? <Slot label="Stadium" sub="shared" muted /> : <span aria-hidden />}
        <Slot
          label={you ? "Your Active Pokémon" : "Opponent's Active Pokémon"}
          tall
          muted={dim}
        />
        {you ? <Slot label="Trainer just played" muted /> : <span aria-hidden />}
      </div>

      <div className={`flex flex-col gap-1 sm:gap-2 ${you ? "" : "justify-end"}`}>
        {rightRail}
      </div>
    </div>
  );

  const bench = (
    <div>
      {you && <BenchRow />}
      <p
        className={`text-center text-[10px] font-semibold ${
          you ? "text-text-primary" : "text-text-muted"
        } ${you ? "mt-1" : "mb-1"}`}
      >
        {you ? "Bench (up to 5)" : "Opponent's Bench"}
      </p>
      {!you && <BenchRow muted />}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Opponent's mat runs Bench → Active (their Bench is the far edge);
          yours runs Active → Bench. */}
      {you ? (
        <>
          {activeRow}
          {bench}
        </>
      ) : (
        <>
          {bench}
          {activeRow}
        </>
      )}
    </div>
  );
}

export default function Board() {
  return (
    <figure className="my-6 rounded-xl border border-border bg-surface-elevated p-3 sm:p-5">
      <Mat side="opponent" />

      {/* The two Active Pokémon face each other across this line. */}
      <div className="my-3 border-t border-dashed border-border" />

      <Mat side="you" />

      <Slot label="Your hand" className="mt-2" muted />

      <figcaption className="mt-3 text-center text-xs text-text-muted">
        Your half is the near mat; your opponent&rsquo;s is the mirror image
        above, with the two Active Pok&eacute;mon facing each other. This is the
        same board the replay viewer draws.
      </figcaption>
    </figure>
  );
}
