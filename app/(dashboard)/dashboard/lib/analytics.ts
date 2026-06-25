import { createAdminClient } from "@/lib/supabase/admin";
import cardData from "@/data/cards-standard.json";
import {
  PRODUCTS,
  isAuthEvent,
  productOf,
  type ProductKey,
} from "./products";

// ── DOMAIN STATS (Product highlights) ───────────────────────────────────
//
// Per-Product totals computed directly from app tables, not from the
// analytics event stream. These are the headline numbers each Product
// card leads with — e.g. "Card Catalog · 12,345 cards saved across all
// users". Lightweight, runs once per page render via fetchBehavior.

type CardCollectionRow = { user_id: string; set_id: string; number: string; quantity: number };
type DataEntry = { set_id: string; number: string; market_price: number | null };

let PRICE_INDEX: Map<string, number> | null = null;
function priceIndex(): Map<string, number> {
  if (PRICE_INDEX) return PRICE_INDEX;
  const idx = new Map<string, number>();
  const db = cardData as unknown as Record<string, DataEntry[]>;
  for (const entries of Object.values(db)) {
    for (const e of entries) {
      if (e.market_price == null || e.market_price <= 0) continue;
      idx.set(`${e.set_id}|${e.number}`, e.market_price);
    }
  }
  PRICE_INDEX = idx;
  return idx;
}

export type ProductDomainStats = {
  cardCatalog: {
    totalCards: number;
    totalValue: number;
    distinctOwners: number;
    avgCardsPerUser: number;
    avgValuePerUser: number;
  };
  deckCollection: {
    totalAnalyses: number;
    totalSaved: number;
    analyzedNotSaved: number;
    distinctSavers: number;
    avgSavedPerUser: number;
  };
  metaArchetypes: {
    saved: number;
    shared: number;
  };
};

const PAGE_SIZE = 1000;

async function fetchCardCatalogStats(): Promise<ProductDomainStats["cardCatalog"]> {
  const admin = createAdminClient();
  const prices = priceIndex();
  let totalCards = 0;
  let totalValue = 0;
  const owners = new Set<string>();
  let from = 0;
  // Paginate — Supabase caps each request at 1000 rows. Loop until empty.
  for (;;) {
    const { data, error } = await admin
      .from("user_card_collection")
      .select("user_id, set_id, number, quantity")
      .gt("quantity", 0)
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    const rows = data as CardCollectionRow[];
    for (const row of rows) {
      totalCards += row.quantity;
      owners.add(row.user_id);
      const price = prices.get(`${row.set_id}|${row.number}`);
      if (price) totalValue += price * row.quantity;
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const distinctOwners = owners.size;
  return {
    totalCards,
    totalValue: Math.round(totalValue * 100) / 100,
    distinctOwners,
    avgCardsPerUser: distinctOwners > 0 ? totalCards / distinctOwners : 0,
    avgValuePerUser:
      distinctOwners > 0 ? Math.round((totalValue / distinctOwners) * 100) / 100 : 0,
  };
}

async function fetchDeckCollectionStats(): Promise<ProductDomainStats["deckCollection"]> {
  const admin = createAdminClient();
  // Cheap count("exact", head: true) — same approach as app/page.tsx.
  const [analysesRes, savedRes] = await Promise.all([
    admin
      .from("analysis_submissions")
      .select("id", { count: "exact", head: true }),
    admin
      .from("saved_decks")
      .select("id", { count: "exact", head: true }),
  ]);

  // distinct_savers — full select capped at 50k, then dedupe in-memory.
  // Cheaper than a server-side DISTINCT until we outgrow it; the row
  // count is bounded by saved_decks size which is small at our scale.
  const { data: savers } = await admin
    .from("saved_decks")
    .select("user_id")
    .limit(50_000);
  const distinctSavers = new Set<string>(
    ((savers ?? []) as { user_id: string }[]).map((r) => r.user_id),
  ).size;

  const totalAnalyses = analysesRes.count ?? 0;
  const totalSaved = savedRes.count ?? 0;
  return {
    totalAnalyses,
    totalSaved,
    // Approximation: every saved deck implies an analysis. Negative
    // values are clamped to 0 in case the counts drift (rare).
    analyzedNotSaved: Math.max(0, totalAnalyses - totalSaved),
    distinctSavers,
    avgSavedPerUser: distinctSavers > 0 ? totalSaved / distinctSavers : 0,
  };
}

async function fetchMetaArchetypeStats(
  windowDays: number,
): Promise<ProductDomainStats["metaArchetypes"]> {
  const admin = createAdminClient();
  const sinceIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString();
  })();
  const [savedRes, sharedRes] = await Promise.all([
    admin
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "meta.deck.saved")
      .gte("occurred_at", sinceIso),
    admin
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "meta.deck.shared")
      .gte("occurred_at", sinceIso),
  ]);
  return {
    saved: savedRes.count ?? 0,
    shared: sharedRes.count ?? 0,
  };
}

export async function fetchProductDomainStats(
  windowDays: number,
): Promise<ProductDomainStats> {
  const [cardCatalog, deckCollection, metaArchetypes] = await Promise.all([
    fetchCardCatalogStats(),
    fetchDeckCollectionStats(),
    fetchMetaArchetypeStats(windowDays),
  ]);
  return { cardCatalog, deckCollection, metaArchetypes };
}

// Formatter helpers — Product cards lean on terse numbers (12.3K, $4.5K)
// because the row is wide and the label already provides context.
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return n.toLocaleString();
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtAvg(n: number): string {
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

function highlightsFor(
  productKey: ProductKey,
  domain: ProductDomainStats,
): ProductHighlight[] {
  switch (productKey) {
    case "card_catalog": {
      const s = domain.cardCatalog;
      return [
        { label: "Total cards saved", value: fmtCount(s.totalCards) },
        { label: "Total collection value", value: fmtMoney(s.totalValue) },
        {
          label: "Avg cards / user",
          value: fmtAvg(s.avgCardsPerUser),
          hint: `${s.distinctOwners} owners`,
        },
        { label: "Avg value / user", value: fmtMoney(s.avgValuePerUser) },
      ];
    }
    case "deck_collection": {
      const s = domain.deckCollection;
      return [
        {
          label: "Decks analyzed (not saved)",
          value: fmtCount(s.analyzedNotSaved),
          hint: `${fmtCount(s.totalAnalyses)} analyses total`,
        },
        { label: "Total saved decks", value: fmtCount(s.totalSaved) },
        {
          label: "Avg saved / user",
          value: fmtAvg(s.avgSavedPerUser),
          hint: `${s.distinctSavers} savers`,
        },
      ];
    }
    case "meta_archetypes": {
      const s = domain.metaArchetypes;
      return [
        { label: "Meta decks saved (window)", value: fmtCount(s.saved) },
        { label: "Meta decks shared (window)", value: fmtCount(s.shared) },
      ];
    }
    default:
      return [];
  }
}

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
  // Same metric for the prior window of equal length so the page can
  // surface week-over-week deltas without a second RPC. Both fields are
  // computed from the same trendRows walk.
  fireCountPrior: number;
  fireCountDelta: number;
  // Null when prior == 0 (avoid div-by-zero / infinite growth artifact).
  fireCountDeltaPct: number | null;
  weekly: number[]; // 4 weekly buckets, oldest → newest
};

// Per-Product domain stats — not derived from analytics_events. Each
// Product card leads with these (totals, averages, etc) before showing
// event roll-ups beneath. Examples: card-catalog totals come from
// `user_card_collection` joined to `cards-standard.json` prices; the
// deck-collection totals come from `analysis_submissions` + `saved_decks`.
export type ProductHighlight = {
  label: string;
  value: string;
  // Optional sub-text shown beneath the value (e.g. "across 42 users").
  hint?: string;
};

// Aggregated Product-level view derived from FeatureRow[]. Each Product
// rolls up its constituent events so the page can answer "which Product
// is paying off?" without translating event names in your head.
export type ProductRow = {
  productKey: ProductKey;
  label: string;
  description: string;
  // True when at least one constituent event has fires in either window.
  // False = "not yet instrumented" placeholder.
  instrumented: boolean;
  userCount: number;
  fireCount: number;
  fireCountPrior: number;
  fireCountDelta: number;
  fireCountDeltaPct: number | null;
  weekly: number[];
  // The raw events that contributed to this Product, sorted by fireCount
  // desc. Empty for uninstrumented Products.
  events: FeatureRow[];
  // Headline domain stats — these are the primary content for a Product
  // card. Empty array when the Product has no domain data wired up yet.
  highlights: ProductHighlight[];
};

export type BehaviorData = {
  windowDays: number;
  activeUsers: number;
  // Distinct user_ids active in the prior window of equal length. Used to
  // render the north-star delta chip.
  activeUsersPrior: number;
  // Active users per week for the last 4 weeks (oldest → newest). Drives
  // the north-star sparkline.
  activeUsersWeekly: number[];
  features: FeatureRow[];
  products: ProductRow[];
  firstVsReturning: {
    firstSessionUsers: number;
    returningSessionUsers: number;
  };
  totalFires: number;
  totalFiresPrior: number;
};

export type RetentionCohort = {
  // ISO date (Monday UTC) marking the start of the signup week.
  weekStart: string;
  cohortSize: number;
  // Retention by week offset from signup. Index 0 = signup week. Null when
  // the offset is in the future — the cohort hasn't had a chance to retain
  // yet.
  retention: (number | null)[];
};

export type RetentionData = {
  cohorts: RetentionCohort[];
  weekCount: number;
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

  // Pull enough events back to cover both the 4-week sparkline AND the
  // prior window we compare against. For a 7d window the standard 28d
  // span suffices; for 30d we need 60d so the prior window has full data.
  const trendDays = Math.max(28, windowDays * 2);
  const sinceIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - trendDays);
    return d.toISOString();
  })();
  const { data: trendRows } = await admin
    .from("analytics_events")
    .select("event_name, occurred_at, user_id")
    .gte("occurred_at", sinceIso)
    .not("user_id", "is", null)
    .limit(50_000);

  // Walk trendRows once to derive:
  //   - 4-week sparkline buckets per event
  //   - current-window fire count per event (sorting key for "time-spent")
  //   - prior-window fire count per event (delta source)
  //   - active-users-per-week buckets (north-star sparkline)
  //   - prior-window active user set (north-star delta)
  const weeklyBuckets = new Map<string, number[]>();
  const fireCounts = new Map<string, number>();
  const priorFireCounts = new Map<string, number>();
  const weeklyUserSets: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  const priorActiveSet = new Set<string>();
  const now = Date.now();
  const windowMs = windowDays * 86_400_000;
  for (const row of (trendRows ?? []) as {
    event_name: string;
    occurred_at: string;
    user_id: string | null;
  }[]) {
    const age = now - new Date(row.occurred_at).getTime();
    const ageDays = age / 86_400_000;
    // Sparkline buckets only span the most recent 28 days regardless of
    // window — keeps the chart trustworthy for narrow windows.
    if (ageDays <= 28) {
      const bucket = Math.min(3, Math.max(0, 3 - Math.floor(ageDays / 7)));
      let arr = weeklyBuckets.get(row.event_name);
      if (!arr) {
        arr = [0, 0, 0, 0];
        weeklyBuckets.set(row.event_name, arr);
      }
      arr[bucket]++;
      if (row.user_id) weeklyUserSets[bucket].add(row.user_id);
    }
    if (age <= windowMs) {
      fireCounts.set(row.event_name, (fireCounts.get(row.event_name) ?? 0) + 1);
    } else if (age <= 2 * windowMs) {
      priorFireCounts.set(row.event_name, (priorFireCounts.get(row.event_name) ?? 0) + 1);
      if (row.user_id) priorActiveSet.add(row.user_id);
    }
  }

  const features: FeatureRow[] = rows.map((r) => {
    const fireCount = fireCounts.get(r.event_name) ?? 0;
    const fireCountPrior = priorFireCounts.get(r.event_name) ?? 0;
    const fireCountDelta = fireCount - fireCountPrior;
    const fireCountDeltaPct =
      fireCountPrior > 0 ? (fireCountDelta / fireCountPrior) * 100 : null;
    return {
      eventName: r.event_name,
      userCount: Number(r.user_count) || 0,
      pctOfActive:
        activeTotal > 0
          ? Math.round((Number(r.user_count) / activeTotal) * 1000) / 10
          : 0,
      fireCount,
      fireCountPrior,
      fireCountDelta,
      fireCountDeltaPct,
      weekly: weeklyBuckets.get(r.event_name) ?? [0, 0, 0, 0],
    };
  });

  const activeUsersWeekly = weeklyUserSets.map((s) => s.size);
  const totalFires = features.reduce((s, f) => s + f.fireCount, 0);
  const totalFiresPrior = features.reduce((s, f) => s + f.fireCountPrior, 0);

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

  const domain = await fetchProductDomainStats(windowDays);
  const products = aggregateProducts(features, domain);

  return {
    windowDays,
    activeUsers: activeTotal,
    activeUsersPrior: priorActiveSet.size,
    activeUsersWeekly,
    features,
    products,
    firstVsReturning: { firstSessionUsers, returningSessionUsers },
    totalFires,
    totalFiresPrior,
  };
}

// Roll FeatureRow[] into ProductRow[] in display order (matches PRODUCTS).
// Auth events are dropped: they belong to the funnel + north-star, not to
// any one Product. Distinct-user counts are taken across the union of
// contributing events so a user firing two events in the same Product is
// counted once.
function aggregateProducts(
  features: FeatureRow[],
  domain: ProductDomainStats,
): ProductRow[] {
  // We don't have per-event distinct-user sets here (RPC returns counts,
  // not raw user_ids), so userCount is approximated as the max across
  // contributing events. It's a known lower bound — the true count sits
  // between max(constituent) and sum(constituent) — and is good enough for
  // a Product-level "scale of usage" cue.
  const byProduct = new Map<ProductKey, FeatureRow[]>();
  for (const f of features) {
    if (isAuthEvent(f.eventName)) continue;
    const key = productOf(f.eventName);
    let arr = byProduct.get(key);
    if (!arr) {
      arr = [];
      byProduct.set(key, arr);
    }
    arr.push(f);
  }

  const rows: ProductRow[] = [];
  for (const meta of PRODUCTS) {
    const evts = (byProduct.get(meta.key) ?? []).sort(
      (a, b) => b.fireCount - a.fireCount,
    );
    if (meta.key === "other" && evts.length === 0) continue; // hide empty "Other"
    const highlights = highlightsFor(meta.key, domain);
    // A Product is treated as "instrumented" when it has either event
    // signals or domain stats — both surface real numbers, both deserve
    // the full card treatment instead of the empty-state placeholder.
    const instrumented =
      evts.some((e) => e.fireCount > 0 || e.fireCountPrior > 0) ||
      highlights.length > 0;
    const fireCount = evts.reduce((s, e) => s + e.fireCount, 0);
    const fireCountPrior = evts.reduce((s, e) => s + e.fireCountPrior, 0);
    const fireCountDelta = fireCount - fireCountPrior;
    const fireCountDeltaPct =
      fireCountPrior > 0 ? (fireCountDelta / fireCountPrior) * 100 : null;
    const userCount = evts.reduce((m, e) => Math.max(m, e.userCount), 0);
    const weekly = [0, 0, 0, 0];
    for (const e of evts) {
      for (let i = 0; i < 4; i++) weekly[i] += e.weekly[i] ?? 0;
    }
    rows.push({
      productKey: meta.key,
      label: meta.label,
      description: meta.description,
      instrumented,
      userCount,
      fireCount,
      fireCountPrior,
      fireCountDelta,
      fireCountDeltaPct,
      weekly,
      events: evts,
      highlights,
    });
  }
  return rows;
}

// ── RETENTION ───────────────────────────────────────────────────────────
//
// Aggregate signup-week × week-N retention. No PII surfaced — we hold
// user_ids in memory only long enough to bucket activity into weeks, and
// emit only counts and percentages. The cohort and event tables we read
// already live on Supabase free tier, so this adds zero storage.

function weekIndexUtc(ms: number): number {
  // Math.floor(ms / week) starts the week on Thursday because epoch is
  // 1970-01-01 = Thursday. Offset by 4 days to align week boundaries on
  // Monday UTC. The exact day-of-week doesn't matter for retention math;
  // we just need a stable, consistent bucket.
  const weekMs = 7 * 86_400_000;
  return Math.floor((ms - -4 * 86_400_000) / weekMs);
}

function weekStartIso(weekIdx: number): string {
  const weekMs = 7 * 86_400_000;
  const ms = weekIdx * weekMs + -4 * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function fetchRetention(weeksBack: number = 8): Promise<RetentionData> {
  const admin = createAdminClient();

  const weekMs = 7 * 86_400_000;
  const sinceMs = Date.now() - weeksBack * weekMs;
  const sinceIso = new Date(sinceMs).toISOString();

  // 1. Profiles signed up in the lookback window.
  const { data: profileRows, error: profErr } = await admin
    .from("profiles")
    .select("id, created_at")
    .gte("created_at", sinceIso);
  if (profErr) console.error("[analytics] retention profiles fetch failed:", profErr);
  const profiles = ((profileRows ?? []) as { id: string; created_at: string }[]);

  if (profiles.length === 0) {
    return { cohorts: [], weekCount: weeksBack };
  }

  // 2. Activity events for the same users in the same lookback window.
  const userIds = profiles.map((p) => p.id);
  const { data: eventRows, error: eventErr } = await admin
    .from("analytics_events")
    .select("user_id, occurred_at")
    .in("user_id", userIds)
    .gte("occurred_at", sinceIso)
    .not("user_id", "is", null)
    .limit(50_000);
  if (eventErr) console.error("[analytics] retention events fetch failed:", eventErr);

  // 3. Per-user set of week-indices where they were active. We aggregate
  //    away the user_id as soon as the cohort percentages are computed —
  //    nothing user-specific leaves this function.
  const userWeeks = new Map<string, Set<number>>();
  for (const ev of (eventRows ?? []) as { user_id: string; occurred_at: string }[]) {
    const w = weekIndexUtc(new Date(ev.occurred_at).getTime());
    let s = userWeeks.get(ev.user_id);
    if (!s) {
      s = new Set();
      userWeeks.set(ev.user_id, s);
    }
    s.add(w);
  }

  // 4. Bucket profiles into cohorts by signup week.
  const cohortMap = new Map<number, string[]>();
  for (const p of profiles) {
    const w = weekIndexUtc(new Date(p.created_at).getTime());
    let arr = cohortMap.get(w);
    if (!arr) {
      arr = [];
      cohortMap.set(w, arr);
    }
    arr.push(p.id);
  }

  // 5. For each cohort compute the retention[N] series. We keep `weeksBack`
  //    columns wide so the matrix is rectangular even for new cohorts.
  const nowWeek = weekIndexUtc(Date.now());
  const cohorts: RetentionCohort[] = [];
  cohortMap.forEach((users, cohortWeek) => {
    const retention: (number | null)[] = [];
    for (let n = 0; n < weeksBack; n++) {
      const target = cohortWeek + n;
      if (target > nowWeek) {
        retention.push(null);
        continue;
      }
      let retained = 0;
      for (const uid of users) {
        if (userWeeks.get(uid)?.has(target)) retained++;
      }
      retention.push(users.length > 0 ? (retained / users.length) * 100 : 0);
    }
    cohorts.push({
      weekStart: weekStartIso(cohortWeek),
      cohortSize: users.length,
      retention,
    });
  });

  // Newest cohort at the top — that's the one to watch.
  cohorts.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  return { cohorts, weekCount: weeksBack };
}
