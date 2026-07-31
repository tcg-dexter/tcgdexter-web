import type { OpsData } from "../lib/ops";
import { links } from "../lib/links";
import { ErrorBox, ExternalLinkPill, relTime } from "./Card";

type Props = { data: OpsData | { error: string } };

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25",
  partial: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/25",
  failed: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:ring-rose-500/25",
};

const STATUS_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-rose-500",
};

export default function OpsCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const latest = data.latest;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          {latest ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${STATUS_TONE[latest.status] ?? "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/15"}`}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${STATUS_DOT[latest.status] ?? "bg-gray-400"}`}
                />
                <span
                  className={`relative inline-flex h-1.5 w-1.5 rounded-full ${STATUS_DOT[latest.status] ?? "bg-gray-400"}`}
                />
              </span>
              {latest.status}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 dark:bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700 dark:text-white/70 ring-1 ring-gray-200 dark:ring-white/15">
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

        {/* 14-day status dots — anchored to the right of the header on
            desktop. When the row runs out of horizontal room, flex-wrap
            drops the dots onto the next line so the layout stays clean. */}
        {data.history.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">14d</span>
            <div className="flex flex-wrap gap-1">
              {data.history.map((h, i) => (
                <span
                  key={`${h.run_date}-${i}`}
                  title={`${h.run_date} · ${h.status} · ${Math.round(Number(h.total_seconds))}s`}
                  className={`h-2.5 w-2.5 rounded-sm ring-1 ring-white/40 ${STATUS_DOT[h.status] ?? "bg-gray-300 dark:bg-white/20"}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {latest && (
        <details className="group">
          <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] [&::-webkit-details-marker]:hidden">
            <svg
              className="h-3 w-3 flex-shrink-0 transition-transform group-open:rotate-180"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Details
          </summary>
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
              <tbody className="divide-y divide-black/5 dark:divide-white/10">
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
                        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-black/5 dark:border-white/10 pt-3 text-xs">
        <ExternalLinkPill href={links.supabase.table("ops_runs")}>
          ops_runs table
        </ExternalLinkPill>
        <ExternalLinkPill href={links.github.repo("dexter-ops")}>
          dexter-ops repo
        </ExternalLinkPill>
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
    </div>
  );
}
