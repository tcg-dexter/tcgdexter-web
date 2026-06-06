import type { Deploy, DeploysData } from "../lib/vercel-deploys";
import { links } from "../lib/links";
import { Card, relTime } from "./Card";

type Props = { data: DeploysData };

const STATE_TONE: Record<string, string> = {
  READY: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  ERROR: "bg-rose-100 text-rose-700 ring-rose-200",
  CANCELED: "bg-gray-100 text-gray-600 ring-gray-200",
  BUILDING: "bg-sky-100 text-sky-700 ring-sky-200",
  QUEUED: "bg-amber-100 text-amber-700 ring-amber-200",
  INITIALIZING: "bg-amber-100 text-amber-700 ring-amber-200",
};

function StatePill({ state }: { state: string }) {
  const tone =
    STATE_TONE[state] ?? "bg-gray-100 text-gray-600 ring-gray-200";
  return (
    <span
      className={`rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider ring-1 ${tone}`}
    >
      {state.toLowerCase()}
    </span>
  );
}

function DeployRow({ d }: { d: Deploy }) {
  const isProd = d.target === "production";
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <StatePill state={d.state} />
        {isProd ? (
          <span className="shrink-0 rounded-full bg-black/85 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-white">
            prod
          </span>
        ) : null}
        <a
          href={d.inspectorUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[var(--text-primary)] hover:underline"
          title={d.commitMessage ?? d.url}
        >
          {d.commitMessage ?? d.url}
        </a>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[var(--text-muted)] tabular-nums">
          {d.durationSec != null ? <span>{d.durationSec}s</span> : null}
          <span>· {relTime(new Date(d.createdAt).toISOString())}</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-1 text-[11px] text-[var(--text-muted)]">
        {d.branch ? (
          <span className="font-mono">{d.branch}</span>
        ) : null}
        {d.commitSha && d.commitUrl ? (
          <>
            <span>·</span>
            <a
              href={d.commitUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:underline"
            >
              {d.commitSha.slice(0, 7)}
            </a>
          </>
        ) : null}
        {d.creator ? (
          <>
            <span>·</span>
            <span>{d.creator}</span>
          </>
        ) : null}
      </div>
    </li>
  );
}

export default function DeploysCard({ data }: Props) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Recent deploys
        </div>
        <a
          href={links.vercel.deployments()}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-[var(--text-secondary)] hover:underline"
        >
          all ↗
        </a>
      </div>

      {data.available ? (
        data.deploys.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--text-muted)]">
            No recent deployments returned.
          </div>
        ) : (
          <ul className="divide-y divide-black/5">
            {data.deploys.map((d) => (
              <DeployRow key={d.id} d={d} />
            ))}
          </ul>
        )
      ) : (
        <div className="text-xs text-[var(--text-muted)]">
          Not available — {data.reason}.{" "}
          <a
            href={links.vercel.deployments()}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open Vercel
          </a>
          .
        </div>
      )}
    </Card>
  );
}
