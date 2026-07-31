import type { RetentionData } from "../lib/analytics";

/**
 * Aggregate signup-cohort × week-N retention matrix. Rows are signup
 * weeks (newest at the top), columns are weeks-since-signup. Cells show
 * the percentage of the cohort that returned during that week — no
 * individual user is identified anywhere on the page.
 *
 * Colour bands answer "is the habit forming?" at a glance:
 *   ≥ 60% emerald, 30–60% amber, < 30% rose, future weeks empty.
 */
function cellTone(pct: number | null): string {
  if (pct == null) return "bg-transparent text-[var(--text-muted)]";
  if (pct >= 60) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
  if (pct >= 30) return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  if (pct > 0) return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
  return "bg-[var(--surface)] text-[var(--text-muted)]";
}

function fmtWeekStart(iso: string): string {
  // YYYY-MM-DD → "Mon DD"
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleString(undefined, { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

export default function RetentionMatrix({ data }: { data: RetentionData }) {
  if (data.cohorts.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No signup cohorts in the lookback window yet.
      </p>
    );
  }
  const columns = Array.from({ length: data.weekCount }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          <tr>
            <th className="py-2 pr-4 text-left font-semibold">Signup week</th>
            <th className="py-2 pr-4 text-right font-semibold">Size</th>
            {columns.map((c) => (
              <th key={c} className="py-2 px-2 text-center font-semibold">
                W{c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/10">
          {data.cohorts.map((cohort) => (
            <tr key={cohort.weekStart}>
              <td className="py-2 pr-4 text-left tabular-nums text-[var(--text-secondary)]">
                {fmtWeekStart(cohort.weekStart)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-[var(--text-primary)] font-medium">
                {cohort.cohortSize}
              </td>
              {cohort.retention.map((pct, i) => (
                <td key={i} className="px-1 py-1.5">
                  <div
                    className={`rounded-sm py-1 text-center text-[11px] font-medium tabular-nums ${cellTone(pct)}`}
                    title={
                      pct == null
                        ? "Future week"
                        : `${pct.toFixed(0)}% retained · ${Math.round((pct / 100) * cohort.cohortSize)} of ${cohort.cohortSize}`
                    }
                  >
                    {pct == null ? "—" : `${Math.round(pct)}%`}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
