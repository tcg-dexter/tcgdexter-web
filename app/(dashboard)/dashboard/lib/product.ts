import { createAdminClient } from "@/lib/supabase/admin";

export type SignupPoint = { date: string; count: number };

export type ProductData = {
  users: {
    total: number;
    newLast7d: number;
    newLast30d: number;
    signups30d: SignupPoint[];
  };
  decks: {
    totalSaved: number;
    createdLast7d: number;
    publicCount: number;
  };
  matches: {
    total: number;
    last7d: number;
  };
  analyses: {
    last7d: number;
  };
  vercel:
    | {
        available: true;
        visitors7d: number | null;
        visitors30d: number | null;
        topPages: { path: string; views: number }[];
      }
    | { available: false; reason: string };
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function fetchSupabasePart() {
  const admin = createAdminClient();

  const [
    profilesTotal,
    profilesLast7,
    profilesLast30,
    profilesSignupSeries,
    decksTotal,
    decksLast7,
    decksPublic,
    matchesTotal,
    matchesLast7,
    analysesLast7,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgoIso(7)),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgoIso(30)),
    admin
      .from("profiles")
      .select("created_at")
      .gte("created_at", daysAgoIso(30))
      .order("created_at", { ascending: true }),
    admin.from("saved_decks").select("id", { count: "exact", head: true }),
    admin
      .from("saved_decks")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgoIso(7)),
    admin
      .from("saved_decks")
      .select("id", { count: "exact", head: true })
      .eq("is_public", true),
    admin.from("matches").select("id", { count: "exact", head: true }),
    admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgoIso(7)),
    admin
      .from("analysis_submissions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgoIso(7)),
  ]);

  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of (profilesSignupSeries.data ?? []) as { created_at: string }[]) {
    const key = row.created_at.slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const signups30d: SignupPoint[] = Array.from(buckets, ([date, count]) => ({
    date,
    count,
  }));

  return {
    users: {
      total: profilesTotal.count ?? 0,
      newLast7d: profilesLast7.count ?? 0,
      newLast30d: profilesLast30.count ?? 0,
      signups30d,
    },
    decks: {
      totalSaved: decksTotal.count ?? 0,
      createdLast7d: decksLast7.count ?? 0,
      publicCount: decksPublic.count ?? 0,
    },
    matches: {
      total: matchesTotal.count ?? 0,
      last7d: matchesLast7.count ?? 0,
    },
    analyses: {
      last7d: analysesLast7.count ?? 0,
    },
  };
}

async function fetchVercelPart(): Promise<ProductData["vercel"]> {
  const teamIdRaw = process.env.VERCEL_TEAM_ID;
  const projectIdRaw = process.env.VERCEL_PROJECT_ID;
  const tokenRaw = process.env.VERCEL_TOKEN;
  if (!teamIdRaw || !projectIdRaw || !tokenRaw) {
    return { available: false, reason: "Vercel env vars not set" };
  }
  const teamId: string = teamIdRaw;
  const projectId: string = projectIdRaw;
  const token: string = tokenRaw;

  const since7 = Date.now() - 7 * 86400_000;
  const since30 = Date.now() - 30 * 86400_000;
  const baseHeaders = { Authorization: `Bearer ${token}` };

  async function summary(since: number): Promise<number | null> {
    const url = new URL(`https://api.vercel.com/v1/web-analytics/${teamId}/visitors`);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("since", String(since));
    url.searchParams.set("until", String(Date.now()));
    const res = await fetch(url, { headers: baseHeaders, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { total?: number };
    return typeof json.total === "number" ? json.total : null;
  }

  async function topPagesList(): Promise<{ path: string; views: number }[]> {
    const url = new URL(`https://api.vercel.com/v1/web-analytics/${teamId}/top-pages`);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("since", String(since7));
    url.searchParams.set("until", String(Date.now()));
    url.searchParams.set("limit", "5");
    const res = await fetch(url, { headers: baseHeaders, next: { revalidate: 300 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: { path: string; views: number }[] };
    return json.items ?? [];
  }

  try {
    const [v7, v30, top] = await Promise.all([
      summary(since7),
      summary(since30),
      topPagesList(),
    ]);
    return {
      available: true,
      visitors7d: v7,
      visitors30d: v30,
      topPages: top,
    };
  } catch (err) {
    return { available: false, reason: String(err) };
  }
}

export async function fetchProduct(): Promise<ProductData> {
  const [sb, vercel] = await Promise.all([fetchSupabasePart(), fetchVercelPart()]);
  return { ...sb, vercel };
}
