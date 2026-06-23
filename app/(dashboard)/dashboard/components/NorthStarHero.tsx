import { Sparkline } from "./Card";

/**
 * The single largest number on the page. Frames "did we move it?" and
 * "how far from the goal?" without forcing the reader to scan.
 *
 * Goal comes from an env var so it's tunable per-environment without a
 * schema change — zero storage cost on the Vercel + Supabase free tiers.
 */
export default function NorthStarHero({
  label,
  caption,
  value,
  prior,
  weekly,
  goal,
}: {
  label: string;
  caption: string;
  value: number;
  prior: number;
  weekly: number[];
  goal: number;
}) {
  const delta = value - prior;
  const deltaPct = prior > 0 ? (delta / prior) * 100 : null;
  const goalPct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;

  const tone =
    delta > 0
      ? "bg-emerald-50 text-emerald-700"
      : delta < 0
        ? "bg-rose-50 text-rose-700"
        : "bg-[var(--surface)] text-[var(--text-muted)]";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "–";

  return (
    <section>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-end gap-x-5 gap-y-2">
        <span className="text-5xl font-semibold tracking-tight tabular-nums text-[var(--text-primary)] sm:text-6xl">
          {value.toLocaleString()}
        </span>
        <div className="flex flex-col gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
          >
            <span aria-hidden>{arrow}</span>
            {Math.abs(delta).toLocaleString()}
            {deltaPct != null
              ? ` (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%)`
              : ""}
            <span className="text-[10px] font-normal opacity-80">
              vs prior period
            </span>
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">{caption}</span>
        </div>
        {weekly.length > 0 ? (
          <div className="ml-auto shrink-0">
            <Sparkline values={weekly} width={160} height={44} stroke="#10b981" />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Last 4 weeks
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 max-w-md">
        <div className="flex items-baseline justify-between text-[11px] text-[var(--text-muted)]">
          <span>
            Goal · {goal.toLocaleString()}
          </span>
          <span className="tabular-nums">{Math.round(goalPct)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface)]">
          <div
            className={`h-full rounded-full ${goalPct >= 100 ? "bg-emerald-500" : "bg-emerald-400"}`}
            style={{ width: `${goalPct}%` }}
          />
        </div>
      </div>
    </section>
  );
}
