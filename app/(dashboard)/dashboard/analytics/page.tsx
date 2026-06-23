import Link from "next/link";
import FunnelBars from "../components/FunnelBars";
import InsightsStrip from "../components/InsightsStrip";
import NorthStarHero from "../components/NorthStarHero";
import ProductAdoptionList from "../components/ProductAdoptionList";
import RetentionMatrix from "../components/RetentionMatrix";
import { SectionHeader, Stat } from "../components/Card";
import {
  fetchActivation,
  fetchBehavior,
  fetchRetention,
} from "../lib/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// Combined Activation + Behavior view structured around the question
// "what should I do next?" — a north-star number with goal progress,
// auto-detected callouts, a ranked feature list with deltas, and a
// retention matrix. All queries are aggregate, no per-user surfaces.
const WINDOWS: { value: string; days: 7 | 30; label: string }[] = [
  { value: "7", days: 7, label: "Last 7 days" },
  { value: "30", days: 30, label: "Last 30 days" },
];

function parseWindow(raw: string | undefined): 7 | 30 {
  return raw === "30" ? 30 : 7;
}

// Goal source: env var so it's tunable per environment without storage.
// Default of 100 is a reasonable v1 target — adjust via DASHBOARD_WAU_GOAL.
function wauGoal(): number {
  const raw = Number(process.env.DASHBOARD_WAU_GOAL);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const windowDays = parseWindow(params.window);

  const [activation, behavior, retention] = await Promise.all([
    fetchActivation(windowDays),
    fetchBehavior(windowDays),
    // 8-week retention lookback is fixed — tied to "habit forming" timescale
    // rather than the window selector at the top of the page.
    fetchRetention(8),
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
  const firesDelta = behavior.totalFires - behavior.totalFiresPrior;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Analytics · last {windowDays} days
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          What should I work on next.
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          North-star activity, what changed since last week, where time is
          actually being spent, and whether the cohorts we're acquiring stick.
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

      {/* ── North-star ──────────────────────────────────────────────────── */}
      <NorthStarHero
        label={`Active users · ${windowDays}d`}
        caption={`${behavior.activeUsersPrior} prior · goal driven by DASHBOARD_WAU_GOAL`}
        value={behavior.activeUsers}
        prior={behavior.activeUsersPrior}
        weekly={behavior.activeUsersWeekly}
        goal={wauGoal()}
      />

      {/* ── What changed ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="What changed"
          title="Top movers this window"
          meta="Funnel bottleneck · biggest mover up · biggest mover down"
        />
        <InsightsStrip behavior={behavior} activation={activation} />
      </section>

      {/* ── Supporting stats ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Active cohort"
          title="Who showed up"
          meta="Distinct user_ids with any event in window"
        />
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Stat
            label="Returning"
            value={behavior.firstVsReturning.returningSessionUsers.toLocaleString()}
            hint={`${returningPct.toFixed(0)}% of active`}
            size="lg"
          />
          <Stat
            label="First session"
            value={behavior.firstVsReturning.firstSessionUsers.toLocaleString()}
            hint={`${firstPct.toFixed(0)}% of active`}
            size="lg"
          />
          <Stat
            label="Feature fires"
            value={behavior.totalFires.toLocaleString()}
            hint={`across ${behavior.features.length} events`}
            delta={{ value: firesDelta }}
            size="lg"
          />
        </div>
      </section>

      {/* ── Product usage ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Products"
          title="Where time actually goes"
          meta="Card Catalog · Deck Collection · Meta Archetypes · Playmat Studio · Spotlight · Learn to Play"
        />
        <ProductAdoptionList rows={behavior.products} />
      </section>

      {/* ── Retention matrix ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Retention"
          title="Are the cohorts we acquire sticking"
          meta="Signup week × week-N activity · 🟢 ≥60% / 🟡 30–60% / 🔴 <30%"
        />
        <RetentionMatrix data={retention} />
      </section>

      {/* ── Activation, demoted ─────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Activation · signed-up users"
          title="Signup → analyze → save → match"
          meta="Bar colour: 🟢 ≥70% / 🟡 40–70% / 🔴 <40% of prior step"
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
    </div>
  );
}
