import type { ProductData } from "../lib/product";
import { Card, ErrorBox, Sparkline, Stat } from "./Card";

type Props = { data: ProductData | { error: string } };

export default function ProductCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const series = data.users.signups30d.map((p) => p.count);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Users" value={data.users.total} hint={`+${data.users.newLast7d} 7d / +${data.users.newLast30d} 30d`} />
          <Stat label="Saved decks" value={data.decks.totalSaved} hint={`+${data.decks.createdLast7d} 7d · ${data.decks.publicCount} public`} />
          <Stat label="Matches" value={data.matches.total} hint={`+${data.matches.last7d} 7d`} />
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Signups · last 30 days
            </div>
            <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
              {series.reduce((a, b) => a + b, 0)} total
            </div>
          </div>
          <Sparkline values={series} width={360} height={42} />
        </div>
        <div className="mt-4 text-[11px] text-[var(--text-muted)]">
          Deck analyses last 7d: <span className="font-semibold tabular-nums">{data.analyses.last7d}</span>
        </div>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Vercel Web Analytics
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
                    <span className="font-mono truncate pr-2">{p.path}</span>
                    <span className="tabular-nums text-[var(--text-muted)]">{p.views}</span>
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
            Not available — {data.vercel.reason}
          </div>
        )}
      </Card>
    </div>
  );
}
