import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { primaryCardImageUrl, primaryPokemonCard } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { resolveOpponentHero } from "@/lib/opponentHeroCard";
import { manualPrizeTotals } from "@/lib/bo3";
import { stripCardIds } from "@/lib/battle-log";
import type { RecentBattle } from "@/app/components/BattleCard";

type AnalysisCard = {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
};

interface DeckRef {
  id: string;
  name: string;
  user_id: string;
}

interface ProfileRef {
  id: string;
  username: string;
}

/** The match_actions columns these aggregates read. Each of the three
 *  queries selects only the subset it needs, so a field another query
 *  selected is simply absent here rather than null. */
interface ActionRow {
  match_id: string;
  actor?: string | null;
  action_type?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Rows requested per page. PostgREST caps a single response server-side
 *  (1000 on this project); asking for exactly that much per page means the
 *  common small-result case still costs one round trip. */
const ACTION_PAGE_SIZE = 1000;
/** Runaway guard. A page that keeps coming back exactly full would loop
 *  forever otherwise; 25 pages is ~25k action rows, far past any real pool. */
const MAX_ACTION_PAGES = 25;

/**
 * Read every row a query matches, not just the first response.
 *
 * `fetchPage` receives an inclusive `[from, to]` row range and MUST apply a
 * deterministic order — without one PostgREST is free to return overlapping
 * or skipped rows between pages, which would double-count damage and prizes
 * rather than merely losing some. Stops on the first short page.
 *
 * Exported for its own test: the paging arithmetic is the part worth
 * pinning, and it's pure once the page fetcher is injected.
 */
export async function fetchAllPages<T>(
  // PromiseLike, not Promise: a supabase-js query builder is thenable but
  // isn't a real Promise until awaited, so callers can hand the builder
  // chain straight in without wrapping it.
  fetchPage: (from: number, to: number) => PromiseLike<T[]>,
  pageSize: number = ACTION_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_ACTION_PAGES; page++) {
    const from = page * pageSize;
    const rows = await fetchPage(from, from + pageSize - 1);
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  console.warn(
    `[recent-battles] hit MAX_ACTION_PAGES (${MAX_ACTION_PAGES}) — results truncated`,
  );
  return out;
}

const BATTLE_ROW_SELECT =
  "id, short_id, result, opponent_archetype, opponent_handle, created_at, saved_deck_id, source, prizes_taken_player, prizes_taken_opponent, game_prizes, game_results";

/**
 * Builds RecentBattle cards from a set of battle rows + the decks/profiles
 * they belong to. Shared by the public battles feed (`loadRecentBattles`,
 * cross-user, admin client, curated) and the profile page's private
 * Recent Battles preview (`loadOwnerRecentBattles`, single user, RLS'd
 * client, uncurated) — the image-resolution and prize-aggregation logic
 * is identical either way, only the input scope and `dropIfNoOpponentArt`
 * differ.
 */
async function assembleRecentBattles(
  sb: SupabaseClient,
  battleRows: Record<string, unknown>[],
  deckById: Map<string, DeckRef>,
  profileById: Map<string, ProfileRef>,
  { dropIfNoOpponentArt }: { dropIfNoOpponentArt: boolean },
): Promise<RecentBattle[]> {
  if (!battleRows.length) return [];

  const battleDeckIds = Array.from(new Set(battleRows.map((m) => m.saved_deck_id as string)));
  const battleIds = battleRows.map((m) => m.id as string);

  // Every match_actions read below is paged (see fetchAllPages). These span
  // the whole battle pool — the `attack` query alone returns ~1200 rows
  // against ~217 public battles — so a single request runs past PostgREST's
  // per-response cap and silently truncates in scan order. That starved the
  // NEWEST battles of their rows, which is exactly the wrong end: every
  // battle inside the Featured Battle's 7-day window came back with
  // totalDamage null, pickFeaturedBattle filtered out all of them, and both
  // /battles and the home page rendered no hero at all. prize_taken was
  // over the same cliff, so prize digits were quietly wrong too.
  const [{ data: deckDetailRows }, attackRows, playRows, prizeRows] = await Promise.all([
    // Not paged: bounded by the number of distinct public decks (~64), well
    // inside one response.
    sb.from("saved_decks").select("id, cover_image_url, analysis").in("id", battleDeckIds),
    fetchAllPages((from, to) =>
      sb
        .from("match_actions")
        .select("match_id, actor, payload")
        .in("match_id", battleIds)
        .eq("action_type", "attack")
        .order("match_id")
        .order("sequence")
        .range(from, to)
        .then(({ data }) => (data ?? []) as ActionRow[]),
    ),
    // Fallback inputs: opponent's played/evolved Pokémon. Used when the
    // opponent never attacked (concede, KO'd before swinging), mirroring
    // the /battles/[id] page's opponent-card resolution.
    fetchAllPages((from, to) =>
      sb
        .from("match_actions")
        .select("match_id, action_type, payload")
        .in("match_id", battleIds)
        .eq("actor", "opponent")
        .in("action_type", ["play_to_active", "play_to_bench", "evolve"])
        .order("match_id")
        .order("sequence")
        .range(from, to)
        .then(({ data }) => (data ?? []) as ActionRow[]),
    ),
    // Prize counts per side per battle, summed from prize_taken actions.
    fetchAllPages((from, to) =>
      sb
        .from("match_actions")
        .select("match_id, actor, payload")
        .in("match_id", battleIds)
        .eq("action_type", "prize_taken")
        .order("match_id")
        .order("sequence")
        .range(from, to)
        .then(({ data }) => (data ?? []) as ActionRow[]),
    ),
  ]);

  const deckDetailById = new Map((deckDetailRows ?? []).map((d) => [d.id as string, d]));

  // Aggregate opponent damage per battle → top attacker name, and total
  // damage across both sides per battle (drives the /battles Featured
  // Battle ranking).
  const opponentDmg = new Map<string, Map<string, number>>();
  const totalDamageByBattle = new Map<string, number>();
  for (const row of attackRows) {
    const payload = row.payload as Record<string, unknown> | null;
    const damage = typeof payload?.damage === "number" ? payload.damage : 0;
    if (!damage) continue;
    const battleId = row.match_id as string;
    totalDamageByBattle.set(battleId, (totalDamageByBattle.get(battleId) ?? 0) + damage);

    if (row.actor !== "opponent") continue;
    const attacker =
      typeof payload?.attacker === "string" ? stripCardIds(payload.attacker).trim() : null;
    if (!attacker) continue;
    if (!opponentDmg.has(battleId)) opponentDmg.set(battleId, new Map());
    const m = opponentDmg.get(battleId)!;
    m.set(attacker, (m.get(attacker) ?? 0) + damage);
  }

  const topAttackerByBattle = new Map<string, string>();
  opponentDmg.forEach((attackerMap, battleId) => {
    let topName = "";
    let topDmg = 0;
    attackerMap.forEach((dmg, name) => {
      if (dmg > topDmg) { topDmg = dmg; topName = name; }
    });
    if (topName) topAttackerByBattle.set(battleId, topName);
  });

  // Fallback per battle: highest-rank Pokémon the opponent put into play.
  const opponentPlaysByBattle = new Map<string, Map<string, number>>();
  for (const row of playRows) {
    const payload = row.payload as Record<string, unknown> | null;
    const rawName =
      row.action_type === "evolve"
        ? (typeof payload?.to === "string" ? payload.to : null)
        : (typeof payload?.card === "string" ? payload.card : null);
    const name = rawName ? stripCardIds(rawName).trim() : null;
    if (!name) continue;
    const battleId = row.match_id as string;
    if (!opponentPlaysByBattle.has(battleId)) opponentPlaysByBattle.set(battleId, new Map());
    const m = opponentPlaysByBattle.get(battleId)!;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  opponentPlaysByBattle.forEach((countByName, battleId) => {
    if (topAttackerByBattle.has(battleId)) return;
    const synthetic: AnalysisCard[] = Array.from(countByName.entries()).map(
      ([name, qty]) => ({ name, qty, number: "", setCode: "", section: "pokemon" }),
    );
    const primary = primaryPokemonCard(synthetic);
    if (primary) topAttackerByBattle.set(battleId, primary.card.name);
  });

  // Prizes taken per side per battle.
  const playerPrizesByBattle = new Map<string, number>();
  const opponentPrizesByBattle = new Map<string, number>();
  for (const row of prizeRows) {
    const payload = row.payload as Record<string, unknown> | null;
    const count =
      typeof payload?.count === "number" && payload.count > 0 ? payload.count : 1;
    const battleId = row.match_id as string;
    const map = row.actor === "player" ? playerPrizesByBattle : opponentPrizesByBattle;
    map.set(battleId, (map.get(battleId) ?? 0) + count);
  }

  return battleRows.flatMap((m) => {
    const deck = deckById.get(m.saved_deck_id as string);
    const profile = deck ? profileById.get(deck.user_id) : null;
    if (!deck || !profile?.username) return [];

    const detail = deckDetailById.get(deck.id);
    const coverUrl = detail?.cover_image_url as string | null | undefined;
    const analysis = detail?.analysis as { cards?: AnalysisCard[] } | null | undefined;
    const deckImageUrl: string | null =
      coverUrl ?? (analysis?.cards ? primaryCardImageUrl(analysis.cards) : null);
    const deckCardNames = Array.from(new Set((analysis?.cards ?? []).map((c) => c.name)));

    const playerPrimary = analysis?.cards ? primaryPokemonCard(analysis.cards) : null;
    const playerColor = typeColor(playerPrimary?.types);

    // A recognized archetype beats gameplay inference — see
    // resolveOpponentHero's own comment for why. gameplayName is the one
    // gameplay-inference signal this cascade already has: the opponent's
    // top-damage attacker, or (folded into the same map above, when nobody
    // attacked) their most-played/evolved-into Pokémon.
    const gameplayName = topAttackerByBattle.get(m.id as string) ?? null;
    const hero = resolveOpponentHero({
      opponentArchetype: (m.opponent_archetype as string | null) ?? null,
      gameplayName,
    });

    let opponentImageUrl: string | null;
    let opponentColor: string;
    if (hero) {
      opponentImageUrl = hero.imageUrl;
      opponentColor = hero.color;
    } else {
      // `dropIfNoOpponentArt` drops a battle we can't even NAME an opponent
      // for — not merely one whose name the card catalog has no art for.
      // The cascade this replaced kept any battle with a top attacker even
      // when its art didn't resolve, rendering the card with no opponent
      // image; folding art-resolution into the drop test (as an earlier
      // pass here did) quietly shrank the public feed, and with it the pool
      // pickFeaturedBattle draws from.
      if (dropIfNoOpponentArt && !gameplayName) return [];
      opponentImageUrl = null;
      opponentColor = typeColor(undefined);
    }

    const manualPrizes = manualPrizeTotals({
      prizes_taken_player: m.prizes_taken_player as number | null,
      prizes_taken_opponent: m.prizes_taken_opponent as number | null,
      game_prizes: m.game_prizes as { p: number | null; o: number | null }[] | null,
    });

    return [{
      id: m.id as string,
      shortId: m.short_id as string,
      result: m.result as "win" | "loss" | "draw",
      opponentArchetype: m.opponent_archetype as string | null,
      opponentHandle: (m.opponent_handle as string | null) ?? null,
      createdAt: m.created_at as string,
      deckId: deck.id,
      deckName: deck.name,
      username: profile.username,
      deckImageUrl: deckImageUrl ?? null,
      deckCardNames,
      opponentImageUrl,
      // Falls back to the raw gameplay name (not just null) on the rare
      // edge case where a name resolved but its card image didn't — same
      // as the old topAttacker-only value's own robustness there.
      opponentAttackerName: hero?.name ?? gameplayName,
      playerColor,
      opponentColor,
      playerPrizes: playerPrizesByBattle.get(m.id as string) ?? manualPrizes?.player ?? 0,
      opponentPrizes: opponentPrizesByBattle.get(m.id as string) ?? manualPrizes?.opponent ?? 0,
      isBestOf3: typeof m.game_results === "string" && m.game_results.length >= 2,
      hasBattleLog: m.source === "tcg_live_log",
      totalDamage: totalDamageByBattle.get(m.id as string) ?? null,
    }];
  });
}

/**
 * Cross-user public battles feed — powers the /battles page. Only battles
 * on public decks owned by public profiles, and only battles with either
 * a parsed battle log or a recognized opponent archetype/prize data (kept
 * visually rich for anonymous browsing; see assembleRecentBattles).
 */
export async function loadRecentBattles(limit = 6): Promise<RecentBattle[]> {
  try {
    const admin = createAdminClient();

    const { data: deckRows, error: deckErr } = await admin
      .from("saved_decks")
      .select("id, name, user_id")
      .eq("is_public", true)
      .limit(200);
    if (deckErr || !deckRows?.length) return [];

    const ownerIds = Array.from(new Set(deckRows.map((d) => d.user_id as string)));
    const { data: profileRows, error: profErr } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", ownerIds)
      .eq("is_public", true);
    if (profErr || !profileRows?.length) return [];

    const pubProfileIds = new Set(profileRows.map((p) => p.id as string));
    const pubDecks = deckRows.filter((d) => pubProfileIds.has(d.user_id as string)) as DeckRef[];
    if (!pubDecks.length) return [];

    const { data: battleRows, error: battleErr } = await admin
      .from("matches")
      .select(BATTLE_ROW_SELECT)
      .or(
        "source.eq.tcg_live_log,and(prizes_taken_player.not.is.null,prizes_taken_opponent.not.is.null),game_prizes.not.is.null"
      )
      .in("saved_deck_id", pubDecks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(Math.min(limit * 4, 400));
    if (battleErr || !battleRows?.length) return [];

    const deckById = new Map(pubDecks.map((d) => [d.id, d]));
    const profileById = new Map(
      (profileRows as ProfileRef[]).map((p) => [p.id, p]),
    );

    const results = await assembleRecentBattles(admin, battleRows, deckById, profileById, {
      dropIfNoOpponentArt: true,
    });
    return results.slice(0, limit);
  } catch (err) {
    console.error("[recent-battles] failed:", err);
    return [];
  }
}

/**
 * A single owner's own recent battles (private — not scoped to public
 * decks/profiles). Powers the profile page's Recent Battles preview.
 * Every logged battle is included regardless of whether a nice opponent
 * image can be resolved (BattleCard degrades to a simple layout when an
 * image is missing) — unlike the public feed, this list shouldn't hide
 * a user's own real battles just because the opponent's archetype isn't
 * a recognized meta deck.
 */
export async function loadOwnerRecentBattles(
  sb: SupabaseClient,
  userId: string,
  username: string,
  limit = 3,
): Promise<RecentBattle[]> {
  try {
    const { data: deckRows, error: deckErr } = await sb
      .from("saved_decks")
      .select("id, name, user_id")
      .eq("user_id", userId);
    if (deckErr || !deckRows?.length) return [];

    const decks = deckRows as DeckRef[];
    const { data: battleRows, error: battleErr } = await sb
      .from("matches")
      .select(BATTLE_ROW_SELECT)
      .in("saved_deck_id", decks.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(limit);
    if (battleErr || !battleRows?.length) return [];

    const deckById = new Map(decks.map((d) => [d.id, d]));
    const profileById = new Map([[userId, { id: userId, username }]]);

    const results = await assembleRecentBattles(sb, battleRows, deckById, profileById, {
      dropIfNoOpponentArt: false,
    });
    return results.slice(0, limit);
  } catch (err) {
    console.error("[recent-battles] owner load failed:", err);
    return [];
  }
}

/**
 * Candidate pool size for `pickFeaturedBattle`. Both surfaces that show the
 * Featured Battle must load the SAME pool — the picker only ranks what it's
 * handed, so a smaller pool silently yields a different "featured" battle.
 */
export const FEATURED_BATTLE_POOL = 200;

/** Days back the Featured Battle is drawn from. */
const FEATURED_BATTLE_WINDOW_DAYS = 7;

/**
 * The current Featured Battle: within the last week, the battle with the most
 * total damage dealt across both sides, ties going to the more recent one —
 * so the fresher of two similar bloodbaths surfaces.
 *
 * Shared by /battles (which renders the hero) and the home page (which
 * showcases that same battle plus its replay), so the two can't drift about
 * what is currently featured. Pass `FEATURED_BATTLE_POOL` to
 * `loadRecentBattles` on both.
 */
export function pickFeaturedBattle(battles: RecentBattle[]): RecentBattle | null {
  const cutoff = Date.now() - FEATURED_BATTLE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return (
    battles
      .filter(
        (m) => m.totalDamage != null && new Date(m.createdAt).getTime() >= cutoff,
      )
      .sort((a, b) => {
        const dt = (b.totalDamage ?? 0) - (a.totalDamage ?? 0);
        if (dt !== 0) return dt;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] ?? null
  );
}
