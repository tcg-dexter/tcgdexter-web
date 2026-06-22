import Link from "next/link";
import EventAdoptionList from "../components/EventAdoptionList";
import { SectionHeader, Stat } from "../components/Card";
import { fetchBehavior } from "../lib/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const WINDOWS: { value: string; days: number; label: string }[] = [
  { value: "7", days: 7, label: "Last 7 days" },
  { value: "30", days: 30, label: "Last 30 days" },
];

function parseWindow(raw: string | undefined): number {
  return raw === "30" ? 30 : 7;
}

export default async function BehaviorPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const windowDays = parseWindow(params.window);
  const data = await fetchBehavior(windowDays);

  const activeKey = String(windowDays);
  const firstPct =
    data.activeUsers > 0
      ? (data.firstVsReturning.firstSessionUsers / data.activeUsers) * 100
      : 0;
  const returningPct =
    data.activeUsers > 0
      ? (data.firstVsReturning.returningSessionUsers / data.activeUsers) * 100
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Behavior · last {windowDays} days
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          What active users do.
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          Distinct users who fired each event at least once in the window,
          alongside a first-time vs returning user split.
        </p>
        <nav className="mt-3 flex items-center gap-1 text-xs">
          {WINDOWS.map((w) => {
            const active = w.value === activeKey;
            return (
              <Link
                key={w.value}
                href={`/dashboard/behavior?window=${w.value}`}
                className={`rounded-md px-2 py-1 transition ${
                  active
                    ? "bg-[var(--surface)] font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
                }`}
              >
                {w.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <section>
        <SectionHeader
          eyebrow="Active cohort"
          title="Users with any event in window"
          meta="From analytics_events"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Active users"
            value={data.activeUsers.toLocaleString()}
            hint={`Last ${windowDays}d`}
            size="lg"
          />
          <Stat
            label="First-time users"
            value={data.firstVsReturning.firstSessionUsers.toLocaleString()}
            hint={`${firstPct.toFixed(1)}% of active`}
          />
          <Stat
            label="Returning users"
            value={data.firstVsReturning.returningSessionUsers.toLocaleString()}
            hint={`${returningPct.toFixed(1)}% of active`}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Feature adoption"
          title="What active users actually fire"
          meta="Sparkline = last 4 weeks"
        />
        <EventAdoptionList rows={data.features} />
      </section>
    </div>
  );
}
