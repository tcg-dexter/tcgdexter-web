/**
 * Weekly-digest data gathering. Two halves:
 *   - per-user recap (follower/following GAINS, decks added, battles logged
 *     in the window) — `gatherUserRecap`
 *   - site-wide modules shared by every recipient — `gatherSiteModules`
 *     (Battle of the Week, a new public deck for the Playmat, a newly
 *     released set)
 *
 * All queries run against the service-role admin client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRecentMatches } from "@/lib/recent-matches";
import type { RecentMatch } from "@/app/components/MatchCard";
import { SET_RELEASE_DATES } from "@/lib/setReleaseDates";
import { setLogo } from "@/lib/setImages";
import { getAllCards } from "@/lib/cardsIndex";

export interface UserRecap {
  followerGains: number;
  followingGains: number;
  decksAdded: number;
  battlesLogged: number;
}

/** Per-user week recap. Gains only — new follow rows in the window, never
 *  losses (unfollows aren't recorded as negatives anyway). */
export async function gatherUserRecap(
  admin: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<UserRecap> {
  const head = { count: "exact" as const, head: true };
  const [followerGains, followingGains, decksAdded, battlesLogged] = await Promise.all([
    admin.from("user_follows").select("*", head).eq("following_user_id", userId).gte("created_at", sinceIso),
    admin.from("user_follows").select("*", head).eq("follower_user_id", userId).gte("created_at", sinceIso),
    admin.from("saved_decks").select("*", head).eq("user_id", userId).gte("created_at", sinceIso),
    admin.from("matches").select("*", head).eq("user_id", userId).gte("created_at", sinceIso),
  ]);
  return {
    followerGains: followerGains.count ?? 0,
    followingGains: followingGains.count ?? 0,
    decksAdded: decksAdded.count ?? 0,
    battlesLogged: battlesLogged.count ?? 0,
  };
}

export interface NewPublicDeck {
  shortId: string | null;
  name: string;
  deckList: string;
  ownerName: string;
}

export interface NewSet {
  setId: string;
  name: string;
  releaseDate: string; // ISO yyyy-mm-dd
  logoUrl: string | null;
}

export interface SiteModules {
  battle: RecentMatch | null;
  deck: NewPublicDeck | null;
  set: NewSet | null;
}

/** The Battle of the Week: highest total-damage match in the window,
 *  mirroring the /battles Featured Battle ranking. */
export async function pickBattleOfWeek(sinceMs: number): Promise<RecentMatch | null> {
  const matches = await loadRecentMatches(200);
  return (
    matches
      .filter((m) => m.totalDamage != null && new Date(m.createdAt).getTime() >= sinceMs)
      .sort((a, b) => {
        const dt = (b.totalDamage ?? 0) - (a.totalDamage ?? 0);
        if (dt !== 0) return dt;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] ?? null
  );
}

/** A public deck added in the window, for the Playmat module. Ranks by
 *  likes then recency. */
export async function pickNewPublicDeck(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<NewPublicDeck | null> {
  const { data } = await admin
    .from("saved_decks")
    .select("short_id, name, deck_list, user_id, like_count, created_at")
    .eq("is_public", true)
    .gte("created_at", sinceIso)
    .order("like_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return null;
  const { data: prof } = await admin
    .from("profiles")
    .select("display_name, username")
    .eq("id", row.user_id)
    .maybeSingle();
  return {
    shortId: row.short_id ?? null,
    name: row.name ?? "Untitled deck",
    deckList: row.deck_list ?? "",
    ownerName: prof?.display_name || prof?.username || "A TCG Dexter player",
  };
}

// Set names aren't in SET_RELEASE_DATES; derive them from the card index.
let setNameCache: Map<string, string> | null = null;
function setNameFor(setId: string): string {
  if (!setNameCache) {
    setNameCache = new Map();
    for (const c of getAllCards()) {
      if (!setNameCache.has(c.setId)) setNameCache.set(c.setId, c.setName);
    }
  }
  return setNameCache.get(setId) ?? setId.toUpperCase();
}

/**
 * The newest set released within the window, or null. `forceSetId` (test
 * only) overrides the window check to render a specific set's module.
 */
export function findNewSet(sinceIso: string, forceSetId?: string): NewSet | null {
  if (forceSetId) {
    return {
      setId: forceSetId,
      name: setNameFor(forceSetId),
      releaseDate: SET_RELEASE_DATES[forceSetId] ?? "",
      logoUrl: setLogo(forceSetId),
    };
  }
  const nowIso = new Date().toISOString().slice(0, 10);
  const since = sinceIso.slice(0, 10);
  let best: NewSet | null = null;
  for (const [setId, date] of Object.entries(SET_RELEASE_DATES)) {
    if (date > since && date <= nowIso) {
      if (!best || date > best.releaseDate) {
        best = { setId, name: setNameFor(setId), releaseDate: date, logoUrl: setLogo(setId) };
      }
    }
  }
  return best;
}

/** Gather all three site-wide modules for one digest run. */
export async function gatherSiteModules(
  admin: SupabaseClient,
  sinceIso: string,
  opts: { forceSetId?: string } = {},
): Promise<SiteModules> {
  const sinceMs = new Date(sinceIso).getTime();
  const [battle, deck] = await Promise.all([
    pickBattleOfWeek(sinceMs),
    pickNewPublicDeck(admin, sinceIso),
  ]);
  return { battle, deck, set: findNewSet(sinceIso, opts.forceSetId) };
}
