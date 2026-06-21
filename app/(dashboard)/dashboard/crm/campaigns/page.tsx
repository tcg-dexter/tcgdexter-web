import Link from "next/link";
import { listCampaigns } from "../lib/queries";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: "draft" | "sending" | "complete" }) {
  const styles: Record<typeof status, string> = {
    draft: "bg-[var(--surface)] text-[var(--text-secondary)]",
    sending: "bg-yellow-100 text-yellow-800",
    complete: "bg-green-100 text-green-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-sm font-semibold text-[var(--text-secondary)]">
          Campaigns
        </h1>
        <Link
          href="/dashboard/crm/campaigns/new"
          className="rounded-md bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          New campaign
        </Link>
      </div>

      <div className="overflow-x-auto">
        {campaigns.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--text-muted)]">
            No campaigns yet.{" "}
            <Link href="/dashboard/crm/campaigns/new" className="underline">
              Create the first
            </Link>
            .
          </div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="bg-[var(--surface)] text-[var(--text-secondary)]">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                  Status
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">
                  Sent / total
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-black/5 hover:bg-[var(--surface)]/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/crm/campaigns/${c.id}`}
                      className="font-medium text-[var(--text-primary)] hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.subject ? (
                      <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[28ch]">
                        {c.subject}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.sent_count} / {c.recipient_count}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">
                    {formatDate(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
