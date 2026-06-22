import type { FunnelStep } from "../lib/analytics";

const STEP_LABELS: Record<string, string> = {
  signup: "Signed up",
  "analyze.completed": "Analyzed a deck",
  "deck.saved": "Saved a deck",
  "match.logged": "Logged a match",
};

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const min = seconds / 60;
  if (min < 60) return `${Math.round(min)}m`;
  const hr = min / 60;
  if (hr < 48) return `${Math.round(hr)}h`;
  const d = hr / 24;
  return `${Math.round(d)}d`;
}

// Colour the funnel bars by step-to-step conversion so the chart reads as
// "where's the bottleneck". The top step has no previous reference and so
// stays neutral; subsequent steps shift through emerald → amber → rose as
// their pctOfPrevious gets worse.
function barClass(pctOfPrevious: number | null): string {
  if (pctOfPrevious == null) return "bg-slate-400";
  if (pctOfPrevious >= 70) return "bg-emerald-500";
  if (pctOfPrevious >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

export default function FunnelBars({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.userCount ?? 0;
  if (top === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        No users in this cohort yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s) => {
        const widthPct = top > 0 ? (s.userCount / top) * 100 : 0;
        const label = STEP_LABELS[s.step] ?? s.step;
        return (
          <div key={s.step} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold text-[var(--text-primary)]">{label}</span>
              <span className="tabular-nums text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">
                  {s.userCount.toLocaleString()}
                </span>
                {s.pctOfPrevious != null ? (
                  <span className="ml-2 text-[var(--text-muted)]">
                    {s.pctOfPrevious.toFixed(1)}% of prev
                  </span>
                ) : null}
                {s.pctOfCohort != null && s.stepOrder > 1 ? (
                  <span className="ml-2 text-[var(--text-muted)]">
                    {s.pctOfCohort.toFixed(1)}% of cohort
                  </span>
                ) : null}
                {s.medianSecondsFromSignup != null && s.stepOrder > 1 ? (
                  <span className="ml-2 text-[var(--text-muted)]">
                    median {fmtDuration(s.medianSecondsFromSignup)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--surface)]">
              <div
                className={`h-full rounded-full ${barClass(s.pctOfPrevious)}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
