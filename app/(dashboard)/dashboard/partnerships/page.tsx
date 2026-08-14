import { listPartners } from "./lib/queries";
import PartnershipsClient from "./PartnershipsClient";

export const dynamic = "force-dynamic";

export default async function PartnershipsPage() {
  const partners = await listPartners();
  const unverified = partners.filter((p) => !p.links_verified).length;
  const highPriority = partners.filter((p) => p.priority === "high").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Partnerships
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          Creator &amp; site outreach
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          {partners.length} prospect{partners.length === 1 ? "" : "s"}
          {highPriority > 0 ? `, ${highPriority} high-priority` : ""}
          {unverified > 0 ? `, ${unverified} with unverified links` : ""}.
          Outreach is DM/social — spot-check a row&apos;s links before
          reaching out.
        </p>
      </header>

      <PartnershipsClient partners={partners} />
    </div>
  );
}
