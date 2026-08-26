import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Achievement keys persisted to public.user_achievements.
 *
 * Keep these stable — they are stored verbatim in the database and used
 * as the join key when rendering the profile achievements card. The
 * catalog (names, categories, thresholds) lives here in code rather than
 * in a DB table, so adding a badge never needs a migration.
 */
export const CERTIFIED_TRAINER = "certified_trainer" as const;

export type AchievementKey =
  | "first_save"
  | "first_battle"
  | "first_battle_log"
  | typeof CERTIFIED_TRAINER
  | "battles_10"
  | "battles_50"
  | "battles_100"
  | "decks_5"
  | "decks_10"
  | "decks_20"
  | "decks_30"
  | "decks_40"
  | "decks_50";

export type AchievementCategory =
  | "Getting Started"
  | "Battle Grind"
  | "Deck Builder";

/** Display order for category groups in the profile drawer. */
export const CATEGORY_ORDER: AchievementCategory[] = [
  "Getting Started",
  "Battle Grind",
  "Deck Builder",
];

/**
 * Per-user counts the count-based badges are evaluated against. Cheap to
 * gather (COUNT-only queries, no row transfer). `certified_trainer` is
 * knowledge-based and not derived from these — it's awarded by the quiz
 * route and merely displayed here.
 */
export type Metrics = {
  savedDecks: number;
  totalBattles: number;
  importBattles: number;
};

export type AchievementDef = {
  key: AchievementKey;
  category: AchievementCategory;
  name: string;
  description: string;
  /**
   * True when the given metrics satisfy this badge. `certified_trainer`
   * returns false here — it is never awarded by reconcile, only by the
   * quiz route — but it still appears in the catalog so the profile can
   * render it (earned/locked) alongside the rest.
   */
  predicate: (m: Metrics) => boolean;
};

/**
 * The full badge catalog. Flat (no tiers); grouped into three categories
 * spanning the core loop (save a deck → log battles → grow a library).
 */
export const CATALOG: AchievementDef[] = [
  // Getting Started
  {
    key: "first_save",
    category: "Getting Started",
    name: "First Save",
    description: "Save your first deck to your library.",
    predicate: (m) => m.savedDecks >= 1,
  },
  {
    key: "first_battle",
    category: "Getting Started",
    name: "First Battle",
    description: "Log your first battle.",
    predicate: (m) => m.totalBattles >= 1,
  },
  {
    key: "first_battle_log",
    category: "Getting Started",
    name: "First Battle Log",
    description: "Import your first battle from a TCG Live battle log.",
    predicate: (m) => m.importBattles >= 1,
  },
  {
    key: CERTIFIED_TRAINER,
    category: "Getting Started",
    name: "Certified Trainer",
    description: "Ace the Trainer Quiz with a perfect score.",
    // Awarded by /api/learn/quiz, never by reconcile.
    predicate: () => false,
  },

  // Battle Grind — total battles logged (any source).
  {
    key: "battles_10",
    category: "Battle Grind",
    name: "Hobbyist",
    description: "Log 10 battles.",
    predicate: (m) => m.totalBattles >= 10,
  },
  {
    key: "battles_50",
    category: "Battle Grind",
    name: "Battle Hardened",
    description: "Log 50 battles.",
    predicate: (m) => m.totalBattles >= 50,
  },
  {
    key: "battles_100",
    category: "Battle Grind",
    name: "Tabletop Titan",
    description: "Log 100 battles.",
    predicate: (m) => m.totalBattles >= 100,
  },

  // Deck Builder — saved-deck count.
  {
    key: "decks_5",
    category: "Deck Builder",
    name: "Developer",
    description: "Save 5 decks.",
    predicate: (m) => m.savedDecks >= 5,
  },
  {
    key: "decks_10",
    category: "Deck Builder",
    name: "Designer",
    description: "Save 10 decks.",
    predicate: (m) => m.savedDecks >= 10,
  },
  {
    key: "decks_20",
    category: "Deck Builder",
    name: "Architect",
    description: "Save 20 decks.",
    predicate: (m) => m.savedDecks >= 20,
  },
  {
    key: "decks_30",
    category: "Deck Builder",
    name: "Scientist",
    description: "Save 30 decks.",
    predicate: (m) => m.savedDecks >= 30,
  },
  {
    key: "decks_40",
    category: "Deck Builder",
    name: "Visionary",
    description: "Save 40 decks.",
    predicate: (m) => m.savedDecks >= 40,
  },
  {
    key: "decks_50",
    category: "Deck Builder",
    name: "Dexter",
    description: "Save 50 decks.",
    predicate: (m) => m.savedDecks >= 50,
  },
];

/**
 * Terse "how you earn it" line for each badge, shown on the back of a
 * flipped badge tile (see FlipBadge). Deliberately shorter than the
 * catalog's `description` (which is a full sentence) — these sit inside
 * tight hexagons and under hero titles, where a sentence wraps badly.
 * Exhaustive by type, so adding a catalog badge fails the typecheck here
 * until its copy is written.
 *
 * Lives beside CATALOG rather than in the component that renders it so
 * both the home-page showcase and the profile module read one source.
 * Plain data — no client-only imports — so the server modules below can
 * keep importing this file freely.
 */
export const REQUIREMENT: Record<AchievementKey, string> = {
  first_save: "Save a deck",
  first_battle: "Log a battle",
  first_battle_log: "Import a log",
  certified_trainer: "Ace the quiz",
  battles_10: "Log 10 battles",
  battles_50: "Log 50 battles",
  battles_100: "Log 100 battles",
  decks_5: "Save 5 decks",
  decks_10: "Save 10 decks",
  decks_20: "Save 20 decks",
  decks_30: "Save 30 decks",
  decks_40: "Save 40 decks",
  decks_50: "Save 50 decks",
};

/** Catalog lookup by key. */
export const CATALOG_BY_KEY: Record<AchievementKey, AchievementDef> =
  Object.fromEntries(CATALOG.map((d) => [d.key, d])) as Record<
    AchievementKey,
    AchievementDef
  >;

/** The catalog keys a user with the given metrics qualifies for. Pure —
 *  `certified_trainer` never appears (its predicate is always false). */
export function qualifiedKeys(metrics: Metrics): AchievementKey[] {
  return CATALOG.filter((d) => d.predicate(metrics)).map((d) => d.key);
}

export type EarnedAchievement = {
  key: AchievementKey;
  earned_at: string;
};

/** Returns true if the user has already earned the given achievement. */
export async function hasAchievement(
  supabase: SupabaseClient,
  userId: string,
  key: AchievementKey,
): Promise<boolean> {
  const { data } = await supabase
    .from("user_achievements")
    .select("achievement_key")
    .eq("user_id", userId)
    .eq("achievement_key", key)
    .maybeSingle();
  return !!data;
}

/** Returns every achievement the given user has earned, newest first. */
export async function listAchievements(
  supabase: SupabaseClient,
  userId: string,
): Promise<EarnedAchievement[]> {
  const { data } = await supabase
    .from("user_achievements")
    .select("achievement_key, earned_at")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false });
  return ((data ?? []) as { achievement_key: string; earned_at: string }[])
    // Drop any keys not in the current catalog (e.g. removed badges) so
    // the display layer never has to guard against unknown keys.
    .filter((row) => row.achievement_key in CATALOG_BY_KEY)
    .map((row) => ({
      key: row.achievement_key as AchievementKey,
      earned_at: row.earned_at,
    }));
}

/** Gather the metrics the count-based badges are evaluated against.
 *  Three COUNT-only queries (head: true → no row transfer). Each is
 *  user-scoped, which RLS also enforces. */
export async function gatherMetrics(
  supabase: SupabaseClient,
  userId: string,
): Promise<Metrics> {
  const [savedDecks, totalBattles, importBattles] = await Promise.all([
    supabase
      .from("saved_decks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "tcg_live_log"),
  ]);
  return {
    savedDecks: savedDecks.count ?? 0,
    totalBattles: totalBattles.count ?? 0,
    importBattles: importBattles.count ?? 0,
  };
}

/**
 * Award any count-based badges the user now qualifies for that they don't
 * already hold. Idempotent (PK + `on conflict do nothing`), so it is safe
 * to call from multiple sites — after a battle/deck write, or on the
 * owner's own profile load as a self-healing backfill. Never touches
 * `certified_trainer` (awarded by the quiz route).
 *
 * Best-effort: any failure is swallowed so it can never break the action
 * that triggered it. Returns the keys newly inserted (empty on no-op or
 * failure) in case a caller wants to celebrate them later.
 */
export async function reconcileAchievements(
  supabase: SupabaseClient,
  userId: string,
): Promise<AchievementKey[]> {
  try {
    const metrics = await gatherMetrics(supabase, userId);

    // Keys the user qualifies for by the numbers.
    const qualified = qualifiedKeys(metrics);
    if (qualified.length === 0) return [];

    // Which of those do they already hold? (Cheap — bounded by catalog
    // size.) Skip re-inserting to keep earned_at stable and avoid churn.
    const { data: existing } = await supabase
      .from("user_achievements")
      .select("achievement_key")
      .eq("user_id", userId)
      .in("achievement_key", qualified);
    const held = new Set(
      ((existing ?? []) as { achievement_key: string }[]).map(
        (r) => r.achievement_key,
      ),
    );

    const toInsert = qualified.filter((k) => !held.has(k));
    if (toInsert.length === 0) return [];

    // upsert + ignoreDuplicates gives row-level `on conflict do nothing`,
    // so a concurrent reconcile racing on one key can't fail the whole
    // batch (a plain insert would 23505 and drop every row).
    const { data: inserted, error } = await supabase
      .from("user_achievements")
      .upsert(
        toInsert.map((key) => ({ user_id: userId, achievement_key: key })),
        { onConflict: "user_id,achievement_key", ignoreDuplicates: true },
      )
      .select("achievement_key");

    if (error) {
      console.error("[achievements] reconcile insert failed:", error);
      return [];
    }
    return ((inserted ?? []) as { achievement_key: string }[]).map(
      (r) => r.achievement_key as AchievementKey,
    );
  } catch (err) {
    console.error("[achievements] reconcile failed:", err);
    return [];
  }
}
