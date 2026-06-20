import Link from "next/link";
import type { CrmCampaign } from "../lib/types";

// Compact at-a-glance summary block above the user table. Shows every
// non-complete campaign with a progress bar so the dashboard can act as a
// communications control center — you should be able to see what's in
// flight without leaving the page.

function StatusDot({ status }: { status: "draft" | "sending" | "complete" }) {
  const color =
    status === "complete"
      ? "bg-green-500"
      : status === "sending"
        ? "bg-yellow-500"
        : "bg-gray-400";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} aria-hidden />;
}

export default function CampaignsModule({ campaigns }: { campaigns: CrmCampaign[] }) {
  const active = campaigns.filter((c) => c.status !== "complete");

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Campaigns
        </h2>
        <Link
          href="/dashboard/crm/campaigns"
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline underline-offset-4"
        >
          See all ↗
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-black/8 bg-white shadow-sm">
        {active.length === 0 ? (
          <div className="flex items-center justify-between gap-3 p-3 text-xs text-[var(--text-muted)]">
            <span>No active campaigns.</span>
            <Link
              href="/dashboard/crm/campaigns/new"
              className="rounded-md bg-black px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
            >
              New campaign
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-black/5">
            {active.map((c) => {
              const total = c.recipient_count;
              const sent = c.sent_count;
              const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/crm/campaigns/${c.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 p-3 hover:bg-[var(--surface)]/40 sm:grid-cols-[1.4fr_2fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusDot status={c.status} />
                        <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {c.name}
                        </span>
                      </div>
                      {c.subject ? (
                        <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                          {c.subject}
                        </div>
                      ) : null}
                    </div>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
                        {sent}/{total}
                      </span>
                    </div>
                    <span className="hidden text-[10px] uppercase tracking-wider text-[var(--text-muted)] sm:inline">
                      {c.status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
