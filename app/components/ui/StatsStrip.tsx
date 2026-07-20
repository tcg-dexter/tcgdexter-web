/**
 * Horizontal stats strip with divided cells. Numbers fade from
 * text-primary (top) to text-secondary (bottom) for a subtle depth cue.
 * Use 1–4 stats. Responsive width clamped by the parent.
 */
export default function StatsStrip({
  stats,
  compact = false,
}: {
  stats: Array<{ label: string; value: string }>;
  /** Halves each cell's vertical padding (16.2px -> 8.1px). Used by the
   *  home page's Decks Profiled / Matches Logged strip; the deck
   *  profile page's card-type breakdown keeps the default sizing. */
  compact?: boolean;
}) {
  const cols =
    stats.length === 2
      ? "grid-cols-2"
      : stats.length === 3
        ? "grid-cols-3"
        : stats.length === 4
          ? "grid-cols-4"
          : "grid-cols-1";

  return (
    <div className={`grid ${cols} divide-x divide-black/10 border-y border-black/10`}>
      {stats.map((s) => (
        <div key={s.label} className={`${compact ? "py-[8.1px]" : "py-[16.2px]"} text-center`}>
          <div className="text-[19px] md:text-[23px] font-semibold tracking-tight bg-gradient-to-b from-text-primary to-text-secondary bg-clip-text text-transparent">
            {s.value}
          </div>
          <div className="mt-1 text-[0.6rem] uppercase tracking-widest text-text-muted">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
