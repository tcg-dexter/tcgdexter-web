const ORG = "tcg-dexter";
const PROJECT_NUMBERS = [4, 5] as const;
const REVALIDATE = 300;

export type RepoSummary = {
  name: string;
  pushedAt: string | null;
  openIssues: number;
  htmlUrl: string;
};

export type IssueSummary = {
  title: string;
  number: number;
  repo: string;
  url: string;
  updatedAt: string;
};

export type ProjectSummary = {
  number: number;
  title: string;
  url: string;
  itemsByStatus: Record<string, number>;
  totalItems: number;
};

export type DevData = {
  repos: RepoSummary[];
  openIssueCount: number;
  recentIssues: IssueSummary[];
  openPrCount: number;
  recentPrs: IssueSummary[];
  projects: ProjectSummary[];
};

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN missing");
  return t;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function ghql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new Error(`GitHub GraphQL → ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

type GhRepo = {
  name: string;
  pushed_at: string | null;
  open_issues_count: number;
  html_url: string;
  archived: boolean;
};

type GhSearchIssue = {
  total_count: number;
  items: {
    title: string;
    number: number;
    html_url: string;
    repository_url: string;
    updated_at: string;
  }[];
};

type GhProjectField = {
  id: string;
  name: string;
  options?: { id: string; name: string }[];
};

type GhProjectItem = {
  fieldValues: {
    nodes: {
      field?: { name: string };
      name?: string; // single-select
    }[];
  };
};

type GhProject = {
  number: number;
  title: string;
  url: string;
  fields: { nodes: GhProjectField[] };
  items: { totalCount: number; nodes: GhProjectItem[] };
};

const PROJECT_QUERY = /* GraphQL */ `
  query ($org: String!, $number: Int!) {
    organization(login: $org) {
      projectV2(number: $number) {
        number
        title
        url
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        items(first: 100) {
          totalCount
          nodes {
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField { name }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function repoNameFromApiUrl(url: string): string {
  return url.split("/").slice(-1)[0] ?? "?";
}

export async function fetchDev(): Promise<DevData> {
  const [repos, openIssues, openPrs, ...projectResults] = await Promise.all([
    gh<GhRepo[]>(`/orgs/${ORG}/repos?per_page=50&sort=pushed`),
    gh<GhSearchIssue>(
      `/search/issues?q=${encodeURIComponent(`org:${ORG} is:issue is:open`)}&sort=updated&order=desc&per_page=10`,
    ),
    gh<GhSearchIssue>(
      `/search/issues?q=${encodeURIComponent(`org:${ORG} is:pr is:open`)}&sort=updated&order=desc&per_page=10`,
    ),
    ...PROJECT_NUMBERS.map((n) =>
      ghql<{ organization: { projectV2: GhProject | null } }>(PROJECT_QUERY, {
        org: ORG,
        number: n,
      }),
    ),
  ]);

  const repoSummaries: RepoSummary[] = repos
    .filter((r) => !r.archived)
    .map((r) => ({
      name: r.name,
      pushedAt: r.pushed_at,
      openIssues: r.open_issues_count,
      htmlUrl: r.html_url,
    }));

  const mapIssue = (it: GhSearchIssue["items"][number]): IssueSummary => ({
    title: it.title,
    number: it.number,
    repo: repoNameFromApiUrl(it.repository_url),
    url: it.html_url,
    updatedAt: it.updated_at,
  });

  const projects: ProjectSummary[] = projectResults
    .map((r) => r.organization.projectV2)
    .filter((p): p is GhProject => Boolean(p))
    .map((p) => {
      const statusField = p.fields.nodes.find((f) => f.name === "Status");
      const itemsByStatus: Record<string, number> = {};
      if (statusField?.options) {
        for (const opt of statusField.options) itemsByStatus[opt.name] = 0;
      }
      for (const item of p.items.nodes) {
        const sv = item.fieldValues.nodes.find((v) => v.field?.name === "Status");
        if (sv?.name) itemsByStatus[sv.name] = (itemsByStatus[sv.name] ?? 0) + 1;
      }
      return {
        number: p.number,
        title: p.title,
        url: p.url,
        itemsByStatus,
        totalItems: p.items.totalCount,
      };
    });

  return {
    repos: repoSummaries,
    openIssueCount: openIssues.total_count,
    recentIssues: openIssues.items.map(mapIssue),
    openPrCount: openPrs.total_count,
    recentPrs: openPrs.items.map(mapIssue),
    projects,
  };
}
