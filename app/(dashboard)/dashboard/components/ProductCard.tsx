import type { ProductData } from "../lib/product";
import { links } from "../lib/links";
import { Card, ErrorBox, Sparkline, Stat } from "./Card";

type Props = { data: ProductData | { error: string } };

export default function ProductCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const signupSeries = data.users.signups30d.map((p) => p.count);
  const signupTotal = signupSeries.reduce((a, b) => a + b, 0);
  const signupPrev7 = signupSeries.slice(-14, -7).reduce((a, b) => a + b, 0);
  const signupDelta = data.users.newLast7d - signupPrev7;

  return (
    <div className="flex flex-col gap-4">
      <Card variant="elevated">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Supabase · users & content
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <a
              href={links.supabase.auth}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            >
              auth users ↗
            </a>
            <a
              href={links.supabase.table("saved_decks")}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            >
              saved_decks ↗
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
          <Stat
            label="Users"
            value={data.users.total}
            size="lg"
            delta={{ value: data.users.newLast7d, suffix: " /7d" }}
            hint={`+${data.users.newLast30d} 30d`}
          />
          <Stat
            label="Saved decks"
            value={data.decks.totalSaved}
            size="lg"
            delta={{ value: data.decks.createdLast7d, suffix: " /7d" }}
            hint={`${data.decks.publicCount} public`}
          />
          <Stat
            label="Matches"
            value={data.matches.total}
            size="lg"
            delta={{ value: data.matches.last7d, suffix: " /7d" }}
          />
          <Stat
            label="Analyses 7d"
            value={data.analyses.last7d}
            size="lg"
          />
        </div>

        <div className="mt-6 rounded-xl border border-black/5 bg-gradient-to-b from-[var(--surface)]/40 to-transparent p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Signups · last 30 days
            </div>
            <div className="flex items-baseline gap-2 text-[11px] tabular-nums">
              <span className="text-[var(--text-secondary)]">{signupTotal} total</span>
              <span
                className={`font-semibold ${signupDelta > 0 ? "text-emerald-600" : signupDelta < 0 ? "text-rose-600" : "text-[var(--text-muted)]"}`}
              >
                {signupDelta >= 0 ? "▲" : "▼"} {Math.abs(signupDelta)} vs prior 7d
              </span>
            </div>
          </div>
          <Sparkline
            values={signupSeries}
            width={620}
            height={56}
            stroke="#10b981"
            responsive
          />
        </div>
      </Card>

      <Card variant="elevated">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Vercel Web Analytics
          </div>
          <a
            href={links.vercel.analytics()}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
          >
            open analytics ↗
          </a>
        </div>
        {data.vercel.available ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Visitors 7d" value={data.vercel.visitors7d ?? "—"} size="lg" />
              <Stat label="Visitors 30d" value={data.vercel.visitors30d ?? "—"} size="lg" />
            </div>
            <div className="mt-6">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Top pages · last 7d
              </div>
              <ul className="-mx-2 text-xs divide-y divide-black/5">
                {data.vercel.topPages.map((p) => (
                  <li key={p.path} className="flex items-center justify-between px-2 py-2 transition hover:bg-[var(--surface)]/50 rounded-md">
                    <a
                      href={`${links.prod}${p.path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono truncate pr-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                    >
                      {p.path}
                    </a>
                    <span className="tabular-nums text-[var(--text-primary)] font-medium">
                      {p.views}
                    </span>
                  </li>
                ))}
                {data.vercel.topPages.length === 0 && (
                  <li className="text-[var(--text-muted)] px-2 py-1.5">No data yet.</li>
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
