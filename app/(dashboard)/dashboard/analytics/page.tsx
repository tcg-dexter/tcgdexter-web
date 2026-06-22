import Link from "next/link";
import EventAdoptionList from "../components/EventAdoptionList";
import FunnelBars from "../components/FunnelBars";
import { SectionHeader, Stat } from "../components/Card";
import { fetchActivation, fetchBehavior } from "../lib/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// Combined Activation + Behavior view. A single `window` URL param drives
// both fetches so the activation funnel and the active-user snapshot share
// a frame.
const WINDOWS: { value: string; days: 7 | 30; label: string }[] = [
  { value: "7", days: 7, label: "Last 7 days" },
  { value: "30", days: 30, label: "Last 30 days" },
];

function parseWindow(raw: string | undefined): 7 | 30 {
  return raw === "30" ? 30 : 7;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const windowDays = parseWindow(params.window);

  // Both fetches reuse the same window. fetchActivation accepts 7 | 30 |
  // null (all-time); we standardise on 7/30 to match behavior. Run in
  // parallel — neither depends on the other.
  const [activation, behavior] = await Promise.all([
    fetchActivation(windowDays),
    fetchBehavior(windowDays),
  ]);

  const activeKey = String(windowDays);
  const firstPct =
    behavior.activeUsers > 0
      ? (behavior.firstVsReturning.firstSessionUsers / behavior.activeUsers) * 100
      : 0;
  const returningPct =
    behavior.activeUsers > 0
      ? (behavior.firstVsReturning.returningSessionUsers / behavior.activeUsers) * 100
      : 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Analytics · {activation.cohortLabel}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Activation and behavior.
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          Where new users drop off — and what active users actually do once
          they stick around.
        </p>
        <nav className="mt-3 flex items-center gap-1 text-xs">
          {WINDOWS.map((w) => {
            const active = w.value === activeKey;
            return (
              <Link
                key={w.value}
                href={`/dashboard/analytics?window=${w.value}`}
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

      {/* ── Activation ───────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Activation · signed-up users"
          title="Signup → analyze → save → match"
          meta="From analytics_events · backfilled"
        />
        <FunnelBars steps={activation.steps} />
      </section>

      <section>
        <SectionHeader
          eyebrow="Activation · anonymous → signup"
          title="Pre-signup visitor funnel"
          meta="By dx_aid cookie · same window"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Anonymous visitors"
            value={activation.anonymous.visitedCount.toLocaleString()}
            hint="Distinct dx_aid cookies seen"
          />
          <Stat
            label="…who analyzed a deck"
            value={activation.anonymous.analyzedCount.toLocaleString()}
            hint={
              activation.anonymous.visitedCount > 0
                ? `${((activation.anonymous.analyzedCount / activation.anonymous.visitedCount) * 100).toFixed(1)}% of visitors`
                : undefined
            }
          />
          <Stat
            label="…who signed up"
            value={activation.anonymous.signedUpCount.toLocaleString()}
            hint={
              activation.anonymous.analyzedCount > 0
                ? `${((activation.anonymous.signedUpCount / activation.anonymous.analyzedCount) * 100).toFixed(1)}% of analyzers`
                : undefined
            }
          />
        </div>
      </section>

      {/* ── Behavior ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Behavior · active cohort"
          title="Users with any event in window"
          meta="From analytics_events"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Active users"
            value={behavior.activeUsers.toLocaleString()}
            hint={`Last ${windowDays}d`}
            size="lg"
          />
          <Stat
            label="First-time users"
            value={behavior.firstVsReturning.firstSessionUsers.toLocaleString()}
            hint={`${firstPct.toFixed(1)}% of active`}
          />
          <Stat
            label="Returning users"
            value={behavior.firstVsReturning.returningSessionUsers.toLocaleString()}
            hint={`${returningPct.toFixed(1)}% of active`}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Behavior · feature adoption"
          title="What active users actually fire"
          meta="Sparkline = last 4 weeks"
        />
        <EventAdoptionList rows={behavior.features} />
      </section>
    </div>
  );
}
