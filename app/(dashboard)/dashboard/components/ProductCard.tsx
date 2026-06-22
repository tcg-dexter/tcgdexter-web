import type { ProductData } from "../lib/product";
import { links } from "../lib/links";
import { ErrorBox, Sparkline, Stat } from "./Card";

type Props = { data: ProductData | { error: string } };

export default function ProductCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const signupSeries = data.users.signups30d.map((p) => p.count);
  const signupTotal = signupSeries.reduce((a, b) => a + b, 0);
  const signupPrev7 = signupSeries.slice(-14, -7).reduce((a, b) => a + b, 0);
  const signupDelta = data.users.newLast7d - signupPrev7;

  return (
    <div className="flex flex-col gap-8">
      <div>
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

        <div className="mt-6">
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
      </div>
    </div>
  );
}
