/**
 * Partner-site deep links used across the dashboard.
 *
 * VERCEL_TEAM_SLUG is the only env-driven piece — everything else (Supabase
 * project ref, GitHub org, project board numbers, repo names) is fixed for
 * TCG Dexter and lives here so links stay consistent across components.
 */

const SUPABASE_REF = "jcpknsiehsvoqqyanmnf";
const GH_ORG = "tcg-dexter";

export const PINNED_REPOS = ["tcgdexter-web", "dexter-mono", "dexter-ops"] as const;
export type PinnedRepo = (typeof PINNED_REPOS)[number];

function vercelTeam(): string {
  return process.env.VERCEL_TEAM_SLUG?.trim() || "";
}

export const links = {
  prod: "https://tcgdexter.com",
  preview: "https://preview.tcgdexter.com",

  vercel: {
    dashboard: () => {
      const t = vercelTeam();
      return t ? `https://vercel.com/${t}` : "https://vercel.com/dashboard";
    },
    project: () => {
      const t = vercelTeam();
      return t ? `https://vercel.com/${t}/tcgdexter-web` : "https://vercel.com/dashboard";
    },
    deployments: () => {
      const t = vercelTeam();
      return t
        ? `https://vercel.com/${t}/tcgdexter-web/deployments`
        : "https://vercel.com/dashboard";
    },
    analytics: () => {
      const t = vercelTeam();
      return t
        ? `https://vercel.com/${t}/tcgdexter-web/analytics`
        : "https://vercel.com/dashboard";
    },
    logs: () => {
      const t = vercelTeam();
      return t
        ? `https://vercel.com/${t}/tcgdexter-web/logs`
        : "https://vercel.com/dashboard";
    },
  },

  supabase: {
    project: `https://supabase.com/dashboard/project/${SUPABASE_REF}`,
    tableEditor: `https://supabase.com/dashboard/project/${SUPABASE_REF}/editor`,
    table: (name: string) =>
      `https://supabase.com/dashboard/project/${SUPABASE_REF}/editor?schema=public&table=${encodeURIComponent(name)}`,
    sql: `https://supabase.com/dashboard/project/${SUPABASE_REF}/sql/new`,
    logs: `https://supabase.com/dashboard/project/${SUPABASE_REF}/logs/explorer`,
    auth: `https://supabase.com/dashboard/project/${SUPABASE_REF}/auth/users`,
  },

  github: {
    org: `https://github.com/${GH_ORG}`,
    issues: `https://github.com/issues?q=${encodeURIComponent(`is:open is:issue org:${GH_ORG} sort:updated-desc`)}`,
    prs: `https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr org:${GH_ORG} sort:updated-desc`)}`,
    repo: (name: string) => `https://github.com/${GH_ORG}/${name}`,
    repoIssues: (name: string) => `https://github.com/${GH_ORG}/${name}/issues`,
    repoPulls: (name: string) => `https://github.com/${GH_ORG}/${name}/pulls`,
    project: (n: number) => `https://github.com/orgs/${GH_ORG}/projects/${n}`,
    projectDev: `https://github.com/orgs/${GH_ORG}/projects/4`,
    projectRoadmap: `https://github.com/orgs/${GH_ORG}/projects/5`,
  },
} as const;

export const GH_ORG_NAME = GH_ORG;
export const SUPABASE_PROJECT_REF = SUPABASE_REF;
