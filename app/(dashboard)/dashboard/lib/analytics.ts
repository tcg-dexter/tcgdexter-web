import { createAdminClient } from "@/lib/supabase/admin";

// Cohort windows used by the activation funnel. `null` = all time.
export type Cohort = 7 | 30 | null;

export type FunnelStep = {
  step: string;
  stepOrder: number;
  userCount: number;
  medianSecondsFromSignup: number | null;
  pctOfPrevious: number | null;
  pctOfCohort: number | null;
};

export type ActivationData = {
  cohort: Cohort;
  cohortLabel: string;
  steps: FunnelStep[];
  // Anonymous → signed-up funnel — a second view on the same page that
  // surfaces how many anonymous visitors who tried the core feature
  // eventually signed up.
  anonymous: {
    visitedCount: number;          // distinct anonymous_ids seen in window
    analyzedCount: number;         // …who fired analyze.completed
    signedUpCount: number;         // …who later signed up (same anon id)
  };
};

export type FeatureRow = {
  eventName: string;
  userCount: number;
  pctOfActive: number;
  // Total event fires inside the window. Combined with userCount, this is
  // the closest proxy we have for "time spent in feature": a feature with
  // a high fire count and a high fires-per-user is load-bearing; one with
  // many users but few fires per user is shallow.
  fireCount: number;
  weekly: number[]; // 4 weekly buckets, oldest → newest
};

export type BehaviorData = {
  windowDays: number;
  activeUsers: number;
  features: FeatureRow[];
  firstVsReturning: {
    firstSessionUsers: number;
    returningSessionUsers: number;
  };
};

// ── ACTIVATION ──────────────────────────────────────────────────────────

export async function fetchActivation(cohort: Cohort): Promise<ActivationData> {
  const admin = createAdminClient();

  // Wrap the rpc call so a missing function (e.g. migration not yet applied
  // in dev) returns an empty funnel instead of crashing the dashboard.
  const { data: rpcData, error: rpcErr } = await admin.rpc(
    "analytics_activation_funnel",
    { cohort_days: cohort },
  );
  if (rpcErr) {
    console.error("[analytics] activation funnel rpc failed:", rpcErr);
  }

  type RpcRow = {
    step: string;
    step_order: number;
    user_count: number;
    median_seconds_from_signup: number | null;
  };
  const rows = ((rpcData ?? []) as RpcRow[]).sort(
    (a, b) => a.step_order - b.step_order,
  );

  const signupCount = rows.find((r) => r.step === "signup")?.user_count ?? 0;
  const steps: FunnelStep[] = rows.map((r, idx) => {
    const prev = idx > 0 ? rows[idx - 1].user_count : null;
    return {
      step: r.step,
      stepOrder: r.step_order,
      userCount: Number(r.user_count) || 0,
      medianSecondsFromSignup: r.median_seconds_from_signup
        ? Number(r.median_seconds_from_signup)
        : null,
      pctOfPrevious:
        prev && prev > 0 ? Math.round((Number(r.user_count) / prev) * 1000) / 10 : null,
      pctOfCohort:
        signupCount > 0
          ? Math.round((Number(r.user_count) / signupCount) * 1000) / 10
          : null,
    };
  });

  // ── Anonymous → signed-up funnel ──────────────────────────────────────
  // Time bound matches the cohort selector — all time = full table.
  const sinceIso =
    cohort === null
      ? new Date(0).toISOString()
      : (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - cohort);
          return d.toISOString();
        })();

  // distinct anonymous_ids seen
  const { data: anonRows } = await admin
    .from("analytics_events")
    .select("anonymous_id, event_name, user_id, occurred_at")
    .gte("occurred_at", sinceIso)
    .not("anonymous_id", "is", null)
    .limit(50_000); // safety cap; raise if/when we outgrow it

  const seen = new Set<string>();
  const analyzed = new Set<string>();
  const signedUp = new Set<string>();
  for (const row of (anonRows ?? []) as {
    anonymous_id: string | null;
    event_name: string;
    user_id: string | null;
  }[]) {
    if (!row.anonymous_id) continue;
    seen.add(row.anonymous_id);
    if (row.event_name === "analyze.completed") analyzed.add(row.anonymous_id);
    if (row.event_name === "auth.signed_up") signedUp.add(row.anonymous_id);
  }

  return {
    cohort,
    cohortLabel:
      cohort === null
        ? "All time"
        : cohort === 7
        ? "Last 7 days"
        : "Last 30 days",
    steps,
    anonymous: {
      visitedCount: seen.size,
      analyzedCount: analyzed.size,
      signedUpCount: signedUp.size,
    },
  };
}

// ── BEHAVIOR ────────────────────────────────────────────────────────────

export async function fetchBehavior(windowDays: number = 7): Promise<BehaviorData> {
  const admin = createAdminClient();

  const { data: rpcData, error: rpcErr } = await admin.rpc(
    "analytics_feature_adoption",
    { window_days: windowDays },
  );
  if (rpcErr) {
    console.error("[analytics] feature adoption rpc failed:", rpcErr);
  }

  type RpcRow = {
    event_name: string;
    user_count: number;
    active_total: number;
  };
  const rows = ((rpcData ?? []) as RpcRow[]);
  const activeTotal = Number(rows[0]?.active_total ?? 0);

  // 4-week sparkline per event — one extra query, scoped to the v1 event
  // set so the row count stays bounded.
  const sinceIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 28);
    return d.toISOString();
  })();
  const { data: trendRows } = await admin
    .from("analytics_events")
    .select("event_name, occurred_at, user_id")
    .gte("occurred_at", sinceIso)
    .not("user_id", "is", null)
    .limit(50_000);

  // Walk trendRows once to derive both the 4-week sparkline buckets and the
  // total fire count inside the active `windowDays` window. The window-fire
  // count is what we sort the feature list by, since it's our proxy for
  // "where users actually spend time" rather than just "what they tried".
  const weeklyBuckets = new Map<string, number[]>();
  const fireCounts = new Map<string, number>();
  const now = Date.now();
  const windowMs = windowDays * 86_400_000;
  for (const row of (trendRows ?? []) as {
    event_name: string;
    occurred_at: string;
  }[]) {
    const age = now - new Date(row.occurred_at).getTime();
    const ageDays = age / 86_400_000;
    const bucket = Math.min(3, Math.max(0, 3 - Math.floor(ageDays / 7)));
    let arr = weeklyBuckets.get(row.event_name);
    if (!arr) {
      arr = [0, 0, 0, 0];
      weeklyBuckets.set(row.event_name, arr);
    }
    arr[bucket]++;
    if (age <= windowMs) {
      fireCounts.set(row.event_name, (fireCounts.get(row.event_name) ?? 0) + 1);
    }
  }

  const features: FeatureRow[] = rows.map((r) => ({
    eventName: r.event_name,
    userCount: Number(r.user_count) || 0,
    pctOfActive:
      activeTotal > 0
        ? Math.round((Number(r.user_count) / activeTotal) * 1000) / 10
        : 0,
    fireCount: fireCounts.get(r.event_name) ?? 0,
    weekly: weeklyBuckets.get(r.event_name) ?? [0, 0, 0, 0],
  }));

  // First-session vs returning split.
  // First session = a user_id whose earliest session_id is among sessions
  // observed in the window. Approximation: find user_ids with any event in
  // window, then check whether they have *any* events before the window.
  const beforeIso = sinceIso; // reuse 28d boundary as "before" cutoff
  const { data: priorRows } = await admin
    .from("analytics_events")
    .select("user_id")
    .lt("occurred_at", beforeIso)
    .not("user_id", "is", null)
    .limit(50_000);
  const priorUserIds = new Set<string>(
    ((priorRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  const windowSinceIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString();
  })();
  const { data: windowRows } = await admin
    .from("analytics_events")
    .select("user_id")
    .gte("occurred_at", windowSinceIso)
    .not("user_id", "is", null)
    .limit(50_000);
  const windowUserIds = new Set<string>(
    ((windowRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  let firstSessionUsers = 0;
  let returningSessionUsers = 0;
  windowUserIds.forEach((uid) => {
    if (priorUserIds.has(uid)) returningSessionUsers++;
    else firstSessionUsers++;
  });

  return {
    windowDays,
    activeUsers: activeTotal,
    features,
    firstVsReturning: { firstSessionUsers, returningSessionUsers },
  };
}
