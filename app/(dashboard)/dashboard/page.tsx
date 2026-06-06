import DevCard from "./components/DevCard";
import ProductCard from "./components/ProductCard";
import OpsCard from "./components/OpsCard";
import QuickLinks from "./components/QuickLinks";
import VitalsStrip from "./components/VitalsStrip";
import { fetchDev } from "./lib/github";
import { fetchProduct } from "./lib/product";
import { fetchOps } from "./lib/ops";

export const revalidate = 300;
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
  const [dev, product, ops] = await Promise.all([
    fetchDev().catch((e) => ({ error: String(e) }) as const),
    fetchProduct().catch((e) => ({ error: String(e) }) as const),
    fetchOps().catch((e) => ({ error: String(e) }) as const),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {/* Glanceable vitals strip — top of every load */}
      <VitalsStrip ops={ops} dev={dev} product={product} />

      {/* Main grid: content on left, quick-links rail on right (desktop) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader
              title="Ops"
              hint="Daily ops pipeline · 6am cron · writes to ops_runs"
            />
            <OpsCard data={ops} />
          </section>

          <section>
            <SectionHeader title="Development" hint="GitHub · tcg-dexter org" />
            <DevCard data={dev} />
          </section>

          <section>
            <SectionHeader title="Product" hint="Supabase + Vercel Analytics" />
            <ProductCard data={product} />
          </section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <QuickLinks />
        </div>
      </div>
    </div>
  );
}
