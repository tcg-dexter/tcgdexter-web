import ActivityFeed from "./components/ActivityFeed";
import AnalyticsPreview from "./components/AnalyticsPreview";
import AutoRefresh from "./components/AutoRefresh";
import DeploysCard from "./components/DeploysCard";
import DevCard from "./components/DevCard";
import OpsCard from "./components/OpsCard";
import ProductCard from "./components/ProductCard";
import QuickLinks from "./components/QuickLinks";
import VitalsStrip from "./components/VitalsStrip";
import { SectionHeader } from "./components/Card";
import { fetchActivity } from "./lib/activity";
import { fetchActivation, fetchBehavior } from "./lib/analytics";
import { fetchDeploys } from "./lib/vercel-deploys";
import { fetchDev } from "./lib/github";
import { fetchOps } from "./lib/ops";
import { fetchProduct } from "./lib/product";

// 60s ISR so the client-side AutoRefresh actually pulls fresh data each tick.
// The Vercel + GitHub fetches inside the data libs have their own per-fetch
// revalidate windows (60–300s) to bound rate-limit exposure.
export const revalidate = 60;
export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function DashboardPage() {
  const [dev, product, ops, deploys, activity, activation, behavior] = await Promise.all([
    fetchDev().catch((e) => ({ error: String(e) }) as const),
    fetchProduct().catch((e) => ({ error: String(e) }) as const),
    fetchOps().catch((e) => ({ error: String(e) }) as const),
    fetchDeploys().catch(
      (e) =>
        ({ available: false, reason: String(e) }) as const,
    ),
    fetchActivity().catch((e) => ({ error: String(e) }) as const),
    // 7-day window matches the rolling window used by the Active KPI tile
    // and the Signups · 7d tile so all the in-house analytics share a frame.
    fetchActivation(7).catch((e) => ({ error: String(e) }) as const),
    fetchBehavior(7).catch((e) => ({ error: String(e) }) as const),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {/* Hero header — text + KPI strip sit directly on the page background. */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Mission control · {todayLabel()}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
              {greeting()}.
            </h1>
            <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
              Here's the pulse of TCG Dexter — operations, deploys, signups, and
              what's shipping.
            </p>
          </div>
          <AutoRefresh intervalMs={60_000} />
        </div>
        <VitalsStrip
          ops={ops}
          dev={dev}
          product={product}
          deploys={deploys}
          behavior={behavior}
        />
      </header>

      <div className="flex flex-col gap-6">
        <section>
          <SectionHeader
            eyebrow="Product"
            title="Users, decks & traffic"
            meta="Supabase"
          />
          <ProductCard data={product} />
        </section>

        <section>
          <SectionHeader
            eyebrow="Analytics"
            title="Activation & behavior"
            meta="In-house · last 7 days"
          />
          <AnalyticsPreview activation={activation} behavior={behavior} />
        </section>

        <section>
          <SectionHeader
            eyebrow="Operations"
            title="Daily ops pipeline"
            meta="6am cron · writes to ops_runs"
          />
          <OpsCard data={ops} />
        </section>

        <section>
          <SectionHeader
            eyebrow="Resources"
            title="Quick links"
            meta="Vercel · Supabase · GitHub"
          />
          <QuickLinks />
        </section>

        {deploys.available && (
          <section>
            <SectionHeader
              eyebrow="Deploys"
              title="Recent builds"
              meta="Vercel · last 8"
            />
            <DeploysCard data={deploys} />
          </section>
        )}

        <section>
          <SectionHeader
            eyebrow="Activity"
            title="Real-time pulse"
            meta="Signups · saved decks · matches"
          />
          <ActivityFeed data={activity} />
        </section>

        <section>
          <SectionHeader
            eyebrow="Development"
            title="Engineering throughput"
            meta="GitHub · tcg-dexter org"
          />
          <DevCard data={dev} />
        </section>
      </div>
    </div>
  );
}
