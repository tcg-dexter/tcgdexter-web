import type { OpsData } from "../lib/ops";
import { links } from "../lib/links";
import { Card, ErrorBox, Sparkline, relTime } from "./Card";

type Props = { data: OpsData | { error: string } };

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-100 text-amber-700 ring-amber-200",
  failed: "bg-rose-100 text-rose-700 ring-rose-200",
};

const STATUS_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-rose-500",
};

export default function OpsCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const latest = data.latest;
  const durations = data.history.map((h) => Number(h.total_seconds) || 0);

  return (
    <Card variant="elevated">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {latest ? (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${STATUS_TONE[latest.status] ?? "bg-gray-100 text-gray-700 ring-gray-200"}`}
            >
              {latest.status}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700 ring-1 ring-gray-200">
              no runs
            </span>
          )}
          <div className="text-sm">
            <div className="font-semibold tracking-tight">
              {latest ? `Daily ops — ${latest.run_date}` : "Daily ops"}
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              {latest
                ? `${latest.passed}/${latest.passed + latest.failed} passed · ${Math.round(Number(latest.total_seconds))}s · finished ${relTime(latest.finished_at)}`
                : "Waiting for first run to land in Supabase."}
            </div>
          </div>
        </div>
        <div className="w-full sm:w-auto sm:max-w-[260px] sm:flex-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Duration · last 14 days
          </div>
          <Sparkline values={durations} width={200} height={40} responsive />
        </div>
      </div>

      {/* 14-day status dots */}
      {data.history.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">14d</span>
          <div className="flex flex-wrap gap-1">
            {data.history.map((h, i) => (
              <span
                key={`${h.run_date}-${i}`}
                title={`${h.run_date} · ${h.status} · ${Math.round(Number(h.total_seconds))}s`}
                className={`h-2.5 w-2.5 rounded-sm ring-1 ring-white/40 ${STATUS_DOT[h.status] ?? "bg-gray-300"}`}
              />
            ))}
          </div>
        </div>
      )}

      {latest && (
        <div className="mt-5 rounded-xl border border-black/5 bg-[var(--surface)]/40 p-3 sm:p-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Steps
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[340px] text-xs">
              <thead className="text-[var(--text-muted)]">
                <tr className="text-left">
                  <th className="font-medium py-1">#</th>
                  <th className="font-medium py-1">Name</th>
                  <th className="font-medium py-1 hidden md:table-cell">Note</th>
                  <th className="font-medium py-1 text-right">Time</th>
                  <th className="font-medium py-1 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {latest.steps.map((s) => (
                  <tr key={s.n}>
                    <td className="py-1.5 text-[var(--text-muted)] tabular-nums">{s.n}</td>
                    <td className="py-1.5 font-mono">{s.name}</td>
                    <td className="py-1.5 hidden md:table-cell text-[var(--text-secondary)] truncate max-w-[20ch]">
                      {s.note ?? ""}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{s.seconds.toFixed(1)}s</td>
                    <td className="py-1.5 text-right">
                      {s.ok ? (
                        <span className="text-emerald-600">✓</span>
                      ) : (
                        <span className="text-rose-600">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-black/5 pt-3 text-xs">
        <a
          href={links.supabase.table("ops_runs")}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
        >
          ops_runs table ↗
        </a>
        <span className="text-[var(--text-muted)]">·</span>
        <a
          href={links.github.repo("dexter-ops")}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
        >
          dexter-ops repo ↗
        </a>
        {latest?.log_path && (
          <>
            <span className="hidden text-[var(--text-muted)] sm:inline">·</span>
            <span
              className="hidden sm:inline-block max-w-full truncate font-mono text-[11px] text-[var(--text-muted)]"
              title={latest.log_path}
            >
              log: {latest.log_path}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
