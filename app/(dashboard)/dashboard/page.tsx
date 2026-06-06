import DevCard from "./components/DevCard";
import ProductCard from "./components/ProductCard";
import OpsCard from "./components/OpsCard";
import { fetchDev } from "./lib/github";
import { fetchProduct } from "./lib/product";
import { fetchOps } from "./lib/ops";

export const revalidate = 300;
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [dev, product, ops] = await Promise.all([
    fetchDev().catch((e) => ({ error: String(e) }) as const),
    fetchProduct().catch((e) => ({ error: String(e) }) as const),
    fetchOps().catch((e) => ({ error: String(e) }) as const),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Ops
        </h2>
        <OpsCard data={ops} />
      </section>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Product
        </h2>
        <ProductCard data={product} />
      </section>
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Development
        </h2>
        <DevCard data={dev} />
      </section>
    </div>
  );
}
