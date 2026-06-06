import type { DevData } from "../lib/github";
import { Card, ErrorBox, Stat, relTime } from "./Card";

type Props = { data: DevData | { error: string } };

export default function DevCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Open issues" value={data.openIssueCount} />
          <Stat label="Open PRs" value={data.openPrCount} />
          <Stat label="Active repos" value={data.repos.length} />
        </div>

        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Repos by last push
          </div>
          <ul className="text-xs divide-y divide-black/5">
            {data.repos.slice(0, 6).map((r) => (
              <li key={r.name} className="flex justify-between py-1.5">
                <a
                  href={r.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--text-primary)] hover:underline"
                >
                  {r.name}
                </a>
                <span className="text-[var(--text-muted)] tabular-nums">
                  {relTime(r.pushedAt)} · {r.openIssues} open
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Project boards
        </div>
        <div className="space-y-4">
          {data.projects.map((p) => (
            <div key={p.number}>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold hover:underline"
              >
                {p.title}
              </a>
              <span className="ml-2 text-xs text-[var(--text-muted)]">
                {p.totalItems} items
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(p.itemsByStatus).map(([status, count]) => (
                  <span
                    key={status}
                    className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px]"
                  >
                    {status}: <span className="tabular-nums font-semibold">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {data.projects.length === 0 && (
            <div className="text-xs text-[var(--text-muted)]">No projects found.</div>
          )}
        </div>

        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Recent open issues
          </div>
          <ul className="text-xs space-y-1">
            {data.recentIssues.slice(0, 5).map((i) => (
              <li key={`${i.repo}-${i.number}`} className="truncate">
                <a
                  href={i.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  <span className="text-[var(--text-muted)]">{i.repo}#{i.number}</span>{" "}
                  {i.title}
                </a>
              </li>
            ))}
            {data.recentIssues.length === 0 && (
              <li className="text-[var(--text-muted)]">No open issues.</li>
            )}
          </ul>
        </div>
      </Card>
    </div>
  );
}
