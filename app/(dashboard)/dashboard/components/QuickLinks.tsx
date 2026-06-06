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
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.href}>
            <a
              href={it.href}
              target="_blank"
              rel="noreferrer"
              className={`group flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-[var(--surface)] ${
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

export default function QuickLinks() {
  return (
    <aside className="flex flex-col gap-5 rounded-xl border border-black/8 bg-white p-4 shadow-sm">
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
    </aside>
  );
}
