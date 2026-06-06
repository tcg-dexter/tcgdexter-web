import type { OpsData } from "../lib/ops";
import { Card, ErrorBox, Sparkline, Stat, relTime } from "./Card";

type Props = { data: OpsData | { error: string } };

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
};

export default function OpsCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const latest = data.latest;
  const durations = data.history.map((h) => Number(h.total_seconds) || 0);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {latest ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS_TONE[latest.status] ?? "bg-gray-100 text-gray-700"}`}
            >
              {latest.status}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700">
              no runs
            </span>
          )}
          <div className="text-sm">
            <div className="font-semibold">
              {latest ? `Daily ops — ${latest.run_date}` : "Daily ops"}
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              {latest
                ? `${latest.passed}/${latest.passed + latest.failed} passed · ${Math.round(Number(latest.total_seconds))}s · finished ${relTime(latest.finished_at)}`
                : "Waiting for first run to land in Supabase."}
            </div>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
            Last 14 days · duration
          </div>
          <Sparkline values={durations} width={200} height={36} />
        </div>
      </div>

      {latest && (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Steps
          </div>
          <table className="w-full text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr className="text-left">
                <th className="font-medium py-1">#</th>
                <th className="font-medium py-1">Name</th>
                <th className="font-medium py-1 text-right">Time</th>
                <th className="font-medium py-1 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {latest.steps.map((s) => (
                <tr key={s.n}>
                  <td className="py-1 text-[var(--text-muted)] tabular-nums">{s.n}</td>
                  <td className="py-1 font-mono">{s.name}</td>
                  <td className="py-1 text-right tabular-nums">{s.seconds.toFixed(1)}s</td>
                  <td className="py-1 text-right">
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
          {latest.log_path && (
            <div className="mt-2 text-[11px] text-[var(--text-muted)] font-mono truncate">
              {latest.log_path}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
