import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { lookupCard, lookupPrintingByLiveId, replay } from "@/lib/engine";
import type { GameState, PokemonInPlay } from "@/lib/engine";
import { cardImageUrlForAnyName, cardImageUrlForName } from "@/lib/primaryCardImage";
import { cardImageSmall } from "@/lib/cardImages";

/**
 * GET /api/admin/replay/[matchId]
 *
 * Admin-only. Loads a match's stored battle_log_raw, runs the engine
 * end-to-end, and returns a frame-per-action stream trimmed to what the
 * Replay UI needs (active / bench / pile counts / current turn). The
 * deeper engine state — deck instances, attached tool details — stays
 * server-side so the JSON payload stays small.
 */

interface PokemonFrame {
  name: string;
  damage: number;
  /** Printed HP — null when the name doesn't resolve in the catalog. */
  hp: number | null;
  energy: string[];
  /** One energy-type label per attached energy, in attach order. Used by
   *  the UI to render the row of energy icons in the card footer. Special
   *  / blend energies fall back to "Colorless" since no single type icon
   *  fits them. */
  energyTypes: string[];
  conditions: string[];
  evolutionStack: string[];
  /** Resolved most-recent printing image URL; null on catalog miss. */
  imageUrl: string | null;
}

interface SideFrame {
  handle: string | null;
  active: PokemonFrame | null;
  bench: PokemonFrame[];
  handCount: number;
  deckCount: number;
  discardCount: number;
  discardTop: string | null;
  /** Image URL for the most-recently discarded card (face-up top). */
  discardTopImageUrl: string | null;
  prizesRemaining: number;
}

interface StadiumFrame {
  name: string;
  owner: "player" | "opponent";
  imageUrl: string | null;
}

interface LastPlayedTrainerFrame {
  name: string;
  imageUrl: string | null;
  /** Which side played the card — used by the UI to place it on the correct mat. */
  actor: "player" | "opponent";
}

export interface ReplayFrame {
  /** Index into the original parsed action stream. */
  actionIndex: number;
  turn: number;
  playerTurnNumber: number;
  phase: string;
  /** Active actor at this point in the replay. */
  actor: "player" | "opponent" | "system";
  /** Plain-text description of the action that produced this frame. */
  summary: string;
  player: SideFrame;
  opponent: SideFrame;
  stadium: StadiumFrame | null;
  prizesTaken: { player: number; opponent: number };
  winner: "player" | "opponent" | null;
  /** Item or Supporter card played in the action that produced this frame.
   *  Null for all other action types. The UI shows it next to the player's
   *  draw/discard piles and clears it on the next frame (it's already in
   *  the discard by the time the frame is snapshotted). */
  lastPlayedTrainer: LastPlayedTrainerFrame | null;
}

export interface ReplayPayload {
  matchId: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  /** Highest-damage attacker on each side across the full game. Used by
   *  the Replay header to render "{player primary} vs {opponent primary}". */
  playerPrimaryName: string | null;
  opponentPrimaryName: string | null;
  frames: ReplayFrame[];
  unmatchedLines: string[];
}

// Basic energy types we have icons for (public/types/*.png).
const BASIC_TYPES = new Set([
  "fire",
  "water",
  "grass",
  "lightning",
  "psychic",
  "fighting",
  "darkness",
  "metal",
  "fairy",
  "dragon",
  "colorless",
]);

/** Resolve an attached energy card name to a single type label that maps
 *  to /types/{label}.png. Basic energies parse out of the name; special
 *  / blend energies fall back to "Colorless". */
function energyTypeFromName(name: string): string {
  const m =
    name.match(/^Basic\s+([A-Za-z]+)\s+Energy$/i) ??
    name.match(/^([A-Za-z]+)\s+Energy$/);
  if (m && BASIC_TYPES.has(m[1].toLowerCase())) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return "Colorless";
}

function mapPokemon(
  mon: PokemonInPlay,
  cardIds: Record<string, string>,
): PokemonFrame {
  // Prefer the EXACT printing the player used when the verbose export gave us
  // its id (disambiguates same-name cards the regulation-mark heuristic can't,
  // e.g. picking N's Reshiram me2pt5_154 over its sv9 printings). Fall back to
  // the name-only catalog lookup for the standard export.
  const liveId = cardIds[mon.card.name];
  const catalog =
    (liveId ? lookupPrintingByLiveId(mon.card.name, liveId) : null) ??
    lookupCard(mon.card.name);
  // Show the *exact* card in play. cardImageUrlForName escalates a name to
  // its highest evolution (great for the battle banner, wrong here) — e.g.
  // an N's Zorua basic would render as N's Zoroark ex. The engine catalog
  // already resolved the actual printing, so build the image from its
  // set/number; fall back to the name resolver only when unresolved.
  const imageUrl = catalog?.set_id
    ? cardImageSmall(catalog.set_id, catalog.number)
    : cardImageUrlForName(mon.card.name);
  return {
    name: mon.card.name,
    damage: mon.damage,
    hp: catalog?.hp ?? null,
    energy: mon.attachedEnergy.map((c) => c.name),
    energyTypes: mon.attachedEnergy.map((c) => energyTypeFromName(c.name)),
    conditions: [...mon.conditions],
    evolutionStack: mon.stack.map((c) => c.name),
    imageUrl,
  };
}

// Standard Pokémon TCG decks are exactly 60 cards. The engine doesn't track
// the deck's contents (it conjures cards into visible zones as they're
// revealed, leaving `side.deck` empty), so the draw pile can't be read off
// `side.deck.length`. Derive it instead: 60 minus everything currently out of
// the deck. Card instances move between zones with stable ids, so this stays
// accurate as the game progresses.
const DECK_SIZE = 60;

function cardsInPlay(mon: GameState["sides"]["player"]["bench"][number]): number {
  return (
    1 +
    mon.stack.length +
    mon.attachedEnergy.length +
    mon.attachedTools.length
  );
}

function mapSide(
  side: GameState["sides"]["player"],
  cardIds: Record<string, string>,
  ownedStadium = 0,
): SideFrame {
  const outOfDeck =
    side.hand.length +
    side.discard.length +
    side.lostZone.length +
    side.prizes.length +
    (side.active ? cardsInPlay(side.active) : 0) +
    side.bench.reduce((sum, mon) => sum + cardsInPlay(mon), 0) +
    ownedStadium;

  return {
    handle: side.handle,
    active: side.active ? mapPokemon(side.active, cardIds) : null,
    bench: side.bench.map((mon) => mapPokemon(mon, cardIds)),
    handCount: side.hand.length,
    deckCount: Math.max(0, DECK_SIZE - outOfDeck),
    discardCount: side.discard.length,
    discardTop:
      side.discard.length > 0
        ? side.discard[side.discard.length - 1].name
        : null,
    // The top-discard can be any supertype (a played Item / Supporter /
    // Tool, an attached energy that came off, a KO'd Pokémon, …), so route
    // through the supertype-agnostic resolver — cardImageUrlForName filters
    // to Pokémon only and would silently fall back to the card-back.
    discardTopImageUrl:
      side.discard.length > 0
        ? cardImageUrlForAnyName(side.discard[side.discard.length - 1].name)
        : null,
    prizesRemaining: side.prizes.length,
  };
}

function frameFromState(
  state: GameState,
  actionIndex: number,
  summary: string,
  actor: "player" | "opponent" | "system",
  cardIds: Record<string, string>,
  lastPlayedTrainer: LastPlayedTrainerFrame | null = null,
): ReplayFrame {
  return {
    actionIndex,
    turn: state.turn.number,
    playerTurnNumber: state.turn.playerTurnNumber,
    phase: state.turn.phase,
    actor,
    summary,
    player: mapSide(
      state.sides.player,
      cardIds,
      state.stadium?.owner === "player" ? 1 : 0,
    ),
    opponent: mapSide(
      state.sides.opponent,
      cardIds,
      state.stadium?.owner === "opponent" ? 1 : 0,
    ),
    stadium: state.stadium
      ? {
          name: state.stadium.card.name,
          owner: state.stadium.owner,
          imageUrl: cardImageUrlForAnyName(state.stadium.card.name),
        }
      : null,
    prizesTaken: state.prizesTaken,
    winner: state.winner,
    lastPlayedTrainer,
  };
}

interface MatchRow {
  id: string;
  battle_log_raw: string | null;
  player_handle: string | null;
  opponent_handle: string | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { data: match } = await supabase
    .from("matches")
    .select("id, battle_log_raw, player_handle, opponent_handle")
    .eq("id", matchId)
    .maybeSingle<MatchRow>();
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (!match.battle_log_raw) {
    return NextResponse.json({ error: "Match has no battle log" }, { status: 400 });
  }

  const parsed = parseBattleLog(match.battle_log_raw);
  const playerHandle = match.player_handle ?? parsed.handles[0] ?? "";
  const normalized = normalizePerspective(parsed, playerHandle);
  const result = replay(normalized);

  // Frame 0 = initial state, before any action. Then one frame per action.
  const cardIds = normalized.cardIds;
  const frames: ReplayFrame[] = [];
  frames.push(frameFromState(result.initialState, -1, "Setup", "system", cardIds, null));
  result.states.forEach((state, idx) => {
    const action = normalized.actions[idx];
    const actor = (action.actor ?? "system") as "player" | "opponent" | "system";

    let lastPlayedTrainer: LastPlayedTrainerFrame | null = null;
    if (
      (action.action_type === "play_item" || action.action_type === "play_supporter") &&
      (actor === "player" || actor === "opponent") &&
      typeof action.payload.card === "string"
    ) {
      lastPlayedTrainer = {
        name: action.payload.card,
        imageUrl: cardImageUrlForAnyName(action.payload.card),
        actor,
      };
    }

    frames.push(frameFromState(state, idx, action.raw_text, actor, cardIds, lastPlayedTrainer));
  });

  // Primary attacker per side = highest-damage Pokémon over the whole
  // match. Mirrors the existing /battles/[id] header logic but reads from
  // the in-memory parse rather than the DB, since we already have it
  // tokenised here.
  const dmgByActor: Record<"player" | "opponent", Map<string, number>> = {
    player: new Map(),
    opponent: new Map(),
  };
  for (const action of normalized.actions) {
    if (action.action_type !== "attack") continue;
    if (action.actor !== "player" && action.actor !== "opponent") continue;
    const payload = action.payload as Record<string, unknown>;
    const attacker = typeof payload.attacker === "string" ? payload.attacker : null;
    const damage = typeof payload.damage === "number" ? payload.damage : 0;
    if (!attacker) continue;
    const bucket = dmgByActor[action.actor];
    bucket.set(attacker, (bucket.get(attacker) ?? 0) + damage);
  }
  function topAttacker(bucket: Map<string, number>): string | null {
    let topName: string | null = null;
    let topDmg = 0;
    bucket.forEach((dmg, name) => {
      if (dmg > topDmg) {
        topDmg = dmg;
        topName = name;
      }
    });
    return topName;
  }

  const payload: ReplayPayload = {
    matchId: match.id,
    playerHandle: normalized.player_handle,
    opponentHandle: normalized.opponent_handle,
    playerPrimaryName: topAttacker(dmgByActor.player),
    opponentPrimaryName: topAttacker(dmgByActor.opponent),
    frames,
    unmatchedLines: normalized.unmatched,
  };

  return NextResponse.json(payload);
}
