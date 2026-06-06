import ActivityFeed from "./components/ActivityFeed";
import AutoRefresh from "./components/AutoRefresh";
import DeploysCard from "./components/DeploysCard";
import DevCard from "./components/DevCard";
import OpsCard from "./components/OpsCard";
import ProductCard from "./components/ProductCard";
import QuickLinks from "./components/QuickLinks";
import VitalsStrip from "./components/VitalsStrip";
import { fetchActivity } from "./lib/activity";
import { fetchDeploys } from "./lib/vercel-deploys";
import { fetchDev } from "./lib/github";
import { fetchOps } from "./lib/ops";
import { fetchProduct } from "./lib/product";

// 60s ISR so the client-side AutoRefresh actually pulls fresh data each tick.
// The Vercel + GitHub fetches inside the data libs have their own per-fetch
// revalidate windows (60–300s) to bound rate-limit exposure.
export const revalidate = 60;
export const dynamic = "force-dynamic";

function SectionHeader({
  title,
  hint,
}: {
  title: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </h2>
      {hint ? (
        <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const [dev, product, ops, deploys, activity] = await Promise.all([
    fetchDev().catch((e) => ({ error: String(e) }) as const),
    fetchProduct().catch((e) => ({ error: String(e) }) as const),
    fetchOps().catch((e) => ({ error: String(e) }) as const),
    fetchDeploys().catch(
      (e) =>
        ({ available: false, reason: String(e) }) as const,
    ),
    fetchActivity().catch((e) => ({ error: String(e) }) as const),
  ]);

  return (
    <div className="flex flex-col gap-5">
      {/* Top row: vitals + live refresh chip */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-[var(--text-secondary)]">
            Mission control
          </h1>
          <AutoRefresh intervalMs={60_000} />
        </div>
        <VitalsStrip ops={ops} dev={dev} product={product} deploys={deploys} />
      </div>

      {/* Main grid: content on left, quick-links rail on right (desktop) */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex flex-col gap-5">
          <section>
            <SectionHeader
              title="Ops"
              hint="Daily ops pipeline · 6am cron · writes to ops_runs"
            />
            <OpsCard data={ops} />
          </section>

          <section>
            <SectionHeader title="Deploys" hint="Vercel · last 8 builds" />
            <DeploysCard data={deploys} />
          </section>

          <section>
            <SectionHeader
              title="Activity"
              hint="Signups · saved decks · matches"
            />
            <ActivityFeed data={activity} />
          </section>

          <section>
            <SectionHeader title="Product" hint="Supabase + Vercel Analytics" />
            <ProductCard data={product} />
          </section>

          <section>
            <SectionHeader title="Development" hint="GitHub · tcg-dexter org" />
            <DevCard data={dev} />
          </section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <QuickLinks />
        </div>
      </div>
    </div>
  );
}
