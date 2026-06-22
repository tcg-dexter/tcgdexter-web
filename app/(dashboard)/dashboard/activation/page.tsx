import Link from "next/link";
import FunnelBars from "../components/FunnelBars";
import { SectionHeader, Stat } from "../components/Card";
import { fetchActivation, type Cohort } from "../lib/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const COHORT_OPTIONS: { value: string; cohort: Cohort; label: string }[] = [
  { value: "7", cohort: 7, label: "Last 7 days" },
  { value: "30", cohort: 30, label: "Last 30 days" },
  { value: "all", cohort: null, label: "All time" },
];

function parseCohort(raw: string | undefined): Cohort {
  if (raw === "7") return 7;
  if (raw === "all") return null;
  return 30; // default
}

export default async function ActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  const params = await searchParams;
  const cohort = parseCohort(params.cohort);
  const data = await fetchActivation(cohort);

  const activeKey =
    cohort === 7 ? "7" : cohort === null ? "all" : "30";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Activation funnel · {data.cohortLabel}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Where new users drop off.
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          For users who signed up in the selected window: how many made it to
          each step. Median time is measured from signup.
        </p>
        <nav className="mt-3 flex items-center gap-1 text-xs">
          {COHORT_OPTIONS.map((opt) => {
            const active = opt.value === activeKey;
            return (
              <Link
                key={opt.value}
                href={`/dashboard/activation?cohort=${opt.value}`}
                className={`rounded-md px-2 py-1 transition ${
                  active
                    ? "bg-[var(--surface)] font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <section>
        <SectionHeader
          eyebrow="Signed-up users"
          title="Signup → analyze → save → match"
          meta="From analytics_events · backfilled"
        />
        <FunnelBars steps={data.steps} />
      </section>

      <section>
        <SectionHeader
          eyebrow="Anonymous → signup"
          title="Pre-signup visitor funnel"
          meta="By dx_aid cookie · same window"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Anonymous visitors"
            value={data.anonymous.visitedCount.toLocaleString()}
            hint="Distinct dx_aid cookies seen"
          />
          <Stat
            label="…who analyzed a deck"
            value={data.anonymous.analyzedCount.toLocaleString()}
            hint={
              data.anonymous.visitedCount > 0
                ? `${((data.anonymous.analyzedCount / data.anonymous.visitedCount) * 100).toFixed(1)}% of visitors`
                : undefined
            }
          />
          <Stat
            label="…who signed up"
            value={data.anonymous.signedUpCount.toLocaleString()}
            hint={
              data.anonymous.analyzedCount > 0
                ? `${((data.anonymous.signedUpCount / data.anonymous.analyzedCount) * 100).toFixed(1)}% of analyzers`
                : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}
