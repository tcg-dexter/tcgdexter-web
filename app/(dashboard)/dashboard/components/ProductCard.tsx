import type { ProductData } from "../lib/product";
import { links } from "../lib/links";
import { Card, ErrorBox, Sparkline, Stat } from "./Card";

type Props = { data: ProductData | { error: string } };

export default function ProductCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const signupSeries = data.users.signups30d.map((p) => p.count);
  const signupTotal = signupSeries.reduce((a, b) => a + b, 0);
  const signupPrev7 = signupSeries
    .slice(-14, -7)
    .reduce((a, b) => a + b, 0);
  const signupDelta = data.users.newLast7d - signupPrev7;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Supabase · users & content
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <a
              href={links.supabase.auth}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-secondary)] hover:underline"
            >
              auth users ↗
            </a>
            <a
              href={links.supabase.table("saved_decks")}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-secondary)] hover:underline"
            >
              saved_decks ↗
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat
            label="Users"
            value={data.users.total}
            hint={`+${data.users.newLast7d} 7d · +${data.users.newLast30d} 30d`}
          />
          <Stat
            label="Saved decks"
            value={data.decks.totalSaved}
            hint={`+${data.decks.createdLast7d} 7d · ${data.decks.publicCount} public`}
          />
          <Stat
            label="Matches"
            value={data.matches.total}
            hint={`+${data.matches.last7d} 7d`}
          />
          <Stat
            label="Analyses 7d"
            value={data.analyses.last7d}
          />
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Signups · last 30 days
            </div>
            <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
              {signupTotal} total · {signupDelta >= 0 ? "+" : ""}
              {signupDelta} vs prior 7d
            </div>
          </div>
          <Sparkline values={signupSeries} width={620} height={48} />
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Vercel Web Analytics
          </div>
          <a
            href={links.vercel.analytics()}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-[var(--text-secondary)] hover:underline"
          >
            open analytics ↗
          </a>
        </div>
        {data.vercel.available ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Visitors 7d" value={data.vercel.visitors7d ?? "—"} />
              <Stat label="Visitors 30d" value={data.vercel.visitors30d ?? "—"} />
            </div>
            <div className="mt-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Top pages · last 7d
              </div>
              <ul className="text-xs divide-y divide-black/5">
                {data.vercel.topPages.map((p) => (
                  <li key={p.path} className="flex justify-between py-1.5">
                    <a
                      href={`${links.prod}${p.path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono truncate pr-2 hover:underline"
                    >
                      {p.path}
                    </a>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {p.views}
                    </span>
                  </li>
                ))}
                {data.vercel.topPages.length === 0 && (
                  <li className="text-[var(--text-muted)] py-1.5">No data yet.</li>
                )}
              </ul>
            </div>
          </>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">
            Not available — {data.vercel.reason}.{" "}
            <a
              href={links.vercel.analytics()}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Open the Vercel dashboard
            </a>{" "}
            to view analytics directly.
          </div>
        )}
      </Card>
    </div>
  );
}
