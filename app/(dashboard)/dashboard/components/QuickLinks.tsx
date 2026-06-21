import { links, PINNED_REPOS } from "../lib/links";

function Section({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string; mono?: boolean }[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.href}>
            <a
              href={it.href}
              target="_blank"
              rel="noreferrer"
              className={`group flex items-center justify-between rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--text-primary)] ${
                it.mono ? "font-mono" : ""
              }`}
            >
              <span className="truncate">{it.label}</span>
              <span className="text-[10px] text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Quick-link clusters for Vercel, Supabase, and GitHub. Rendered horizontally
 * as three side-by-side columns on sm+ widths; collapses to a single stacked
 * column on mobile so the rows stay tappable.
 */
export default function QuickLinks() {
  return (
    <div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Section
          title="Vercel"
          items={[
            { label: "Project", href: links.vercel.project() },
            { label: "Deployments", href: links.vercel.deployments() },
            { label: "Analytics", href: links.vercel.analytics() },
            { label: "Logs", href: links.vercel.logs() },
          ]}
        />
        <Section
          title="Supabase"
          items={[
            { label: "Project", href: links.supabase.project },
            { label: "Table editor", href: links.supabase.tableEditor },
            { label: "ops_runs", href: links.supabase.table("ops_runs"), mono: true },
            { label: "profiles", href: links.supabase.table("profiles"), mono: true },
            { label: "SQL editor", href: links.supabase.sql },
            { label: "Auth users", href: links.supabase.auth },
            { label: "Logs", href: links.supabase.logs },
          ]}
        />
        <Section
          title="GitHub"
          items={[
            { label: "Organization", href: links.github.org },
            { label: "All open issues", href: links.github.issues },
            { label: "All open PRs", href: links.github.prs },
            { label: "Project · Development", href: links.github.projectDev },
            { label: "Project · Roadmap", href: links.github.projectRoadmap },
            ...PINNED_REPOS.map((r) => ({
              label: r,
              href: links.github.repo(r),
              mono: true,
            })),
          ]}
        />
      </div>
    </div>
  );
}
