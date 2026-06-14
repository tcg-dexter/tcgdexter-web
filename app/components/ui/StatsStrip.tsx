/**
 * Horizontal stats strip with divided cells. Numbers fade from
 * text-primary (top) to text-secondary (bottom) for a subtle depth cue.
 * Use 1–4 stats. Responsive width clamped by the parent.
 */
export default function StatsStrip({
  stats,
}: {
  stats: Array<{ label: string; value: string }>;
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
        <div key={s.label} className="py-6 text-center">
          <div className="text-2xl md:text-3xl font-semibold tracking-tight bg-gradient-to-b from-text-primary to-text-secondary bg-clip-text text-transparent">
            {s.value}
          </div>
          <div className="mt-1 text-xs uppercase tracking-widest text-text-muted">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
