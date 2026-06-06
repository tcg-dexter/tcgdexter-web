/**
 * Recent Vercel deployments for the tcgdexter-web project.
 *
 * Powers the "Deploys" vital tile + the DeploysCard. Uses the Vercel REST
 * API v6/deployments endpoint with `projectId` + `teamId` filters when the
 * env vars are present; otherwise returns an offline marker so the UI can
 * render a graceful placeholder linking out to the Vercel dashboard.
 */

export type DeployState =
  | "READY"
  | "ERROR"
  | "BUILDING"
  | "QUEUED"
  | "CANCELED"
  | "INITIALIZING"
  | (string & {});

export type Deploy = {
  id: string;
  url: string; // <project>-<hash>.vercel.app (preview) or the alias
  inspectorUrl: string;
  state: DeployState;
  createdAt: number; // epoch ms
  readyAt: number | null;
  durationSec: number | null;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  commitUrl: string | null;
  target: string | null; // "production" | "preview" | null
  creator: string | null;
};

export type DeploysData =
  | {
      available: true;
      deploys: Deploy[];
    }
  | { available: false; reason: string };

type VercelDeploymentApiItem = {
  uid: string;
  url: string;
  inspectorUrl?: string;
  state?: string;
  readyState?: string;
  createdAt: number;
  ready?: number;
  buildingAt?: number;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitRef?: string;
    githubCommitAuthorName?: string;
    githubCommitAuthorLogin?: string;
    githubOrg?: string;
    githubRepo?: string;
  };
  target?: string | null;
  creator?: { username?: string; email?: string };
};

const LIMIT = 8;

export async function fetchDeploys(): Promise<DeploysData> {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return { available: false, reason: "Vercel env vars not set" };
  }

  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("limit", String(LIMIT));
  if (teamId) url.searchParams.set("teamId", teamId);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        available: false,
        reason: `Vercel API ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      };
    }
    const json = (await res.json()) as { deployments?: VercelDeploymentApiItem[] };
    const raw = json.deployments ?? [];

    const deploys: Deploy[] = raw.map((d) => {
      const state = (d.state || d.readyState || "UNKNOWN") as DeployState;
      const readyAt = typeof d.ready === "number" ? d.ready : null;
      const durationSec =
        readyAt && d.createdAt ? Math.max(0, Math.round((readyAt - d.createdAt) / 1000)) : null;
      const sha = d.meta?.githubCommitSha ?? null;
      const org = d.meta?.githubOrg;
      const repo = d.meta?.githubRepo;
      const commitUrl =
        sha && org && repo ? `https://github.com/${org}/${repo}/commit/${sha}` : null;
      return {
        id: d.uid,
        url: d.url,
        inspectorUrl:
          d.inspectorUrl ??
          `https://vercel.com/deployments/${d.uid}`,
        state,
        createdAt: d.createdAt,
        readyAt,
        durationSec,
        branch: d.meta?.githubCommitRef ?? null,
        commitSha: sha,
        commitMessage: d.meta?.githubCommitMessage ?? null,
        commitUrl,
        target: d.target ?? null,
        creator:
          d.meta?.githubCommitAuthorLogin ??
          d.meta?.githubCommitAuthorName ??
          d.creator?.username ??
          d.creator?.email ??
          null,
      };
    });

    return { available: true, deploys };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}
