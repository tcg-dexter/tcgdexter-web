import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Unified product activity feed.
 *
 * Pulls the most recent rows from the three product-engagement tables
 * (profiles = signups, saved_decks, matches), unifies them into a single
 * timeline, and returns the 20 most recent events.
 *
 * Used by the dashboard ActivityFeed widget to give a live pulse of what
 * users are actually doing — distinct from the aggregate counters on the
 * Product card.
 */

export type ActivityKind = "signup" | "saved_deck" | "match";

export type ActivityEvent = {
  kind: ActivityKind;
  at: string; // ISO timestamp
  primary: string; // headline label rendered on the row
  secondary?: string; // muted detail beside the headline
};

export type ActivityData = {
  events: ActivityEvent[];
  fetchedAt: string;
};

const LIMIT_PER_SOURCE = 15;
const FEED_SIZE = 20;

export async function fetchActivity(): Promise<ActivityData> {
  const admin = createAdminClient();

  const [signups, decks, matches] = await Promise.all([
    admin
      .from("profiles")
      .select("id, created_at, display_name, username, tier")
      .order("created_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
    admin
      .from("saved_decks")
      .select("id, created_at, name, is_public, meta_archetype_id")
      .order("created_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
    admin
      .from("matches")
      .select("id, created_at, result, opponent_archetype")
      .order("created_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
  ]);

  const events: ActivityEvent[] = [];

  type SignupRow = {
    id: string;
    created_at: string;
    display_name?: string | null;
    username?: string | null;
    tier?: string | null;
  };
  for (const r of (signups.data ?? []) as SignupRow[]) {
    const name =
      r.display_name?.trim() ||
      (r.username ? `@${r.username}` : null) ||
      "new user";
    events.push({
      kind: "signup",
      at: r.created_at,
      primary: name,
      secondary: r.tier && r.tier !== "free" ? r.tier : undefined,
    });
  }

  type DeckRow = {
    id: string;
    created_at: string;
    name?: string | null;
    is_public?: boolean | null;
    meta_archetype_id?: string | null;
  };
  for (const r of (decks.data ?? []) as DeckRow[]) {
    const meta = r.meta_archetype_id ? r.meta_archetype_id : null;
    const visibility = r.is_public ? "public" : "private";
    events.push({
      kind: "saved_deck",
      at: r.created_at,
      primary: r.name?.trim() || "Untitled deck",
      secondary: meta ? `${meta} · ${visibility}` : visibility,
    });
  }

  type MatchRow = {
    id: string;
    created_at: string;
    result?: string | null;
    opponent_archetype?: string | null;
  };
  for (const r of (matches.data ?? []) as MatchRow[]) {
    const headline = r.result ? `Match · ${r.result}` : "Match logged";
    events.push({
      kind: "match",
      at: r.created_at,
      primary: headline,
      secondary: r.opponent_archetype ?? undefined,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    events: events.slice(0, FEED_SIZE),
    fetchedAt: new Date().toISOString(),
  };
}
