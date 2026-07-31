import type { DevData, IssueLabel, IssueSummary } from "../lib/github";
import { links } from "../lib/links";
import { ErrorBox, ExternalLinkPill, relTime } from "./Card";

type Props = { data: DevData | { error: string } };

function contrastText(hex: string): string {
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#1a1a1a";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.6 ? "#1a1a1a" : "#ffffff";
}

function LabelChips({ labels }: { labels: IssueLabel[] }) {
  if (!labels.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {labels.slice(0, 3).map((l) => (
        <span
          key={l.name}
          className="rounded-full px-1.5 py-[1px] text-[10px] font-medium leading-tight"
          style={{ backgroundColor: `#${l.color}`, color: contrastText(l.color) }}
        >
          {l.name}
        </span>
      ))}
    </span>
  );
}

function IssueRow({ item }: { item: IssueSummary }) {
  return (
    <li className="py-1.5">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group flex items-baseline gap-2"
      >
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {item.repo}#{item.number}
        </span>
        <span className="truncate text-[var(--text-primary)] group-hover:underline">
          {item.title}
        </span>
        <LabelChips labels={item.labels} />
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums">
          {relTime(item.updatedAt)}
        </span>
      </a>
    </li>
  );
}

export default function DevCard({ data }: Props) {
  if ("error" in data) return <ErrorBox error={data.error} />;

  const pinnedRepos = data.repos.filter((r) => r.pinned);

  return (
    <div className="flex flex-col gap-8">
      {/* Repos rail */}
      <div>
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Repos
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          {pinnedRepos.map((r) => (
            <div key={r.name} className="flex flex-col gap-1">
              <a
                href={r.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm font-semibold tracking-tight hover:underline"
              >
                {r.name}
              </a>
              <div className="text-[11px] text-[var(--text-muted)]">
                pushed {relTime(r.pushedAt)}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <a
                  href={links.github.repoIssues(r.name)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                >
                  <span className="tabular-nums">{r.openIssues}</span> open
                </a>
                <span className="text-[var(--text-muted)]">·</span>
                <a
                  href={links.github.repoPulls(r.name)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                >
                  PRs
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Project boards */}
      <div>
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          Project boards
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {data.projects.map((p) => (
            <div key={p.number} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold tracking-tight hover:underline"
                >
                  {p.title}
                </a>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">
                  {p.totalItems} items
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                {Object.entries(p.itemsByStatus).map(([status, count]) => (
                  <span key={status}>
                    {status}: <span className="tabular-nums font-semibold text-[var(--text-primary)]">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {data.projects.length === 0 && (
            <div className="text-xs text-[var(--text-muted)]">No projects found.</div>
          )}
        </div>
      </div>

      {/* Open PRs + Open Issues side-by-side */}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Open PRs
              </span>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                · {data.openPrCount}
              </span>
            </div>
            <ExternalLinkPill href={links.github.prs}>all</ExternalLinkPill>
          </div>
          <ul className="divide-y divide-black/5 dark:divide-white/10 text-xs">
            {data.recentPrs.slice(0, 8).map((i) => (
              <IssueRow key={`${i.repo}-${i.number}`} item={i} />
            ))}
            {data.recentPrs.length === 0 && (
              <li className="py-2 text-[var(--text-muted)]">No open PRs.</li>
            )}
          </ul>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Open issues
              </span>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                · {data.openIssueCount}
              </span>
            </div>
            <ExternalLinkPill href={links.github.issues}>all</ExternalLinkPill>
          </div>
          <ul className="divide-y divide-black/5 dark:divide-white/10 text-xs">
            {data.recentIssues.slice(0, 10).map((i) => (
              <IssueRow key={`${i.repo}-${i.number}`} item={i} />
            ))}
            {data.recentIssues.length === 0 && (
              <li className="py-2 text-[var(--text-muted)]">No open issues.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
