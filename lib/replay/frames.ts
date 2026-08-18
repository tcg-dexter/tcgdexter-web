import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { lookupCard, lookupPrintingByLiveId, replay } from "@/lib/engine";
import type { GameState, PokemonInPlay } from "@/lib/engine";
import { cardImageUrlForAnyName, cardImageUrlForName } from "@/lib/primaryCardImage";
import { cardImageSmall } from "@/lib/cardImages";

/**
 * Builds the Replay viewer's frame stream from a match's stored
 * battle_log_raw: parses the log, runs the engine end-to-end, and trims
 * each resulting state down to what the board needs (active / bench /
 * pile counts / current turn). The deeper engine state — deck instances,
 * attached tool details — stays server-side so the JSON stays small.
 *
 * Shared by the admin Replay tool and the public battles page so both
 * render byte-identical frames; only the access check around them differs.
 */

export interface PokemonFrame {
  /** Engine instance id — stable across turns, unique per Pokémon in play.
   *  The UI keys React elements and framer-motion layoutIds off this, so it
   *  must NOT fall back to the card name: a bench holding three Noctowl
   *  would collide, and colliding layoutIds animate unrelated cards into
   *  each other's slots (stale ghosts, phantom 6th bench card). */
  id: string;
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
  /** Attached Pokémon Tools. The board renders these behind the card with
   *  their title peeking above; without them an equipped Pokémon reads as
   *  bare, so this is board state the replay was previously dropping. */
  tools: { name: string; imageUrl: string | null }[];
}

export interface SideFrame {
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

export interface StadiumFrame {
  name: string;
  owner: "player" | "opponent";
  imageUrl: string | null;
}

export interface LastPlayedTrainerFrame {
  name: string;
  imageUrl: string | null;
  /** Which side played the card — used by the UI to place it on the correct mat. */
  actor: "player" | "opponent";
}

export interface DiscardDrawCard {
  name: string;
  imageUrl: string | null;
}

/** Which beat of the exchange a frame sits on. The overlay reveals one more
 *  group at each: the card played, then what it cost, then what it bought. */
export type DiscardDrawStage = "play" | "discard" | "draw";

export const DISCARD_DRAW_STAGES: DiscardDrawStage[] = [
  "play",
  "discard",
  "draw",
];

/**
 * A "pay cards to get cards" moment — Ultra Ball discarding two to fetch a
 * Pokémon, N's Zoroark ex's Trade, and so on.
 *
 * The log makes this one action: TCG Live writes the discard and the draw as
 * child lines under the card that caused them, not as their own entries, so
 * the parser folds them into that action's payload. To let the viewer walk
 * the exchange a beat at a time, `buildReplayPayload` emits one frame per
 * stage — same board state and same actionIndex on all three, differing only
 * in `stage`. Board state can't differ: the engine has a single post-action
 * state for the whole exchange, and inventing intermediate ones would mean
 * teaching the engine to split an action it currently applies atomically.
 */
export interface DiscardDrawFrame {
  stage: DiscardDrawStage;
  /** Whose mat the overlay belongs over. */
  actor: "player" | "opponent";
  /** Card whose art represents the cause: the item itself, or — for an
   *  ability — the Pokémon that used it. */
  source: DiscardDrawCard;
  /** Ability name when the cause was an ability, else null. The source
   *  card's own name is already the label in that case. */
  abilityName: string | null;
  discarded: DiscardDrawCard[];
  drawn: DiscardDrawCard[];
  /** Total cards drawn. Can exceed `drawn.length`: the log sometimes gives
   *  a count with no card list, in which case the UI has a number to show
   *  even though it has no art. */
  drawnCount: number;
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
  /** Set only on frames whose action both discarded and drew cards. */
  discardDraw: DiscardDrawFrame | null;
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
    id: mon.id,
    name: mon.card.name,
    damage: mon.damage,
    hp: catalog?.hp ?? null,
    energy: mon.attachedEnergy.map((c) => c.name),
    energyTypes: mon.attachedEnergy.map((c) => energyTypeFromName(c.name)),
    conditions: [...mon.conditions],
    evolutionStack: mon.stack.map((c) => c.name),
    imageUrl,
    // Tools are Trainer cards, so resolve through the supertype-agnostic
    // helper — cardImageUrlForName filters to Pokémon and would silently
    // fall back to the card-back here.
    tools: mon.attachedTools.map((c) => ({
      name: c.name,
      imageUrl: cardImageUrlForAnyName(c.name),
    })),
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
  discardDraw: DiscardDrawFrame | null = null,
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
    discardDraw,
  };
}

function toDiscardDrawCard(name: string): DiscardDrawCard {
  return { name, imageUrl: cardImageUrlForAnyName(name) };
}

/**
 * Reads the discard-then-draw overlay off an action, or null when the
 * action isn't one. Both halves are required: a bare discard (a retreat
 * cost, a KO) and a bare draw (the start-of-turn card) are ordinary board
 * events, and raising a full-mat overlay for them would bury the board in
 * interruptions. It's the exchange that's worth stopping on.
 */
function discardDrawFromAction(
  action: { action_type: string; payload: Record<string, unknown> },
  actor: "player" | "opponent" | "system",
): Omit<DiscardDrawFrame, "stage"> | null {
  if (actor !== "player" && actor !== "opponent") return null;

  const payload = action.payload;
  const discarded = Array.isArray(payload.discarded_cards)
    ? (payload.discarded_cards as string[])
    : [];
  const drawn = Array.isArray(payload.drawn_cards)
    ? (payload.drawn_cards as string[])
    : [];
  const drawnCount =
    typeof payload.drawn_count === "number" ? payload.drawn_count : 0;
  if (discarded.length === 0 || drawnCount === 0) return null;

  // For an ability the acting card is the Pokémon, which the parser puts in
  // `source`; for a trainer it's the card named in `card`.
  const isAbility = action.action_type === "ability_used";
  const sourceName = isAbility ? payload.source : payload.card;
  if (typeof sourceName !== "string") return null;

  return {
    actor,
    source: toDiscardDrawCard(sourceName),
    abilityName:
      isAbility && typeof payload.ability_name === "string"
        ? payload.ability_name
        : null,
    discarded: discarded.map(toDiscardDrawCard),
    drawn: drawn.map(toDiscardDrawCard),
    drawnCount,
  };
}

/** Highest-damage attacker for a side, used for the "{X} vs {Y}" header. */
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

/**
 * Parse + replay a raw TCG Live battle log into the viewer's payload.
 * `playerHandle` picks which side the log is normalized to — everything
 * downstream ("player" vs "opponent") is relative to it.
 */
export function buildReplayPayload(
  matchId: string,
  battleLogRaw: string,
  playerHandle: string,
): ReplayPayload {
  const parsed = parseBattleLog(battleLogRaw);
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

    // An exchange occupies one frame per stage rather than one in total, so
    // the playhead can rest on each beat — which also means playback paces
    // it and scrubbing can land inside it. All three share this action's
    // index, so the thread keeps one post spotlighted throughout.
    const exchange = discardDrawFromAction(action, actor);
    const stages: (DiscardDrawFrame | null)[] = exchange
      ? DISCARD_DRAW_STAGES.map((stage) => ({ ...exchange, stage }))
      : [null];

    for (const discardDraw of stages) {
      frames.push(
        frameFromState(
          state,
          idx,
          action.raw_text,
          actor,
          cardIds,
          lastPlayedTrainer,
          discardDraw,
        ),
      );
    }
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

  return {
    matchId,
    playerHandle: normalized.player_handle,
    opponentHandle: normalized.opponent_handle,
    playerPrimaryName: topAttacker(dmgByActor.player),
    opponentPrimaryName: topAttacker(dmgByActor.opponent),
    frames,
    unmatchedLines: normalized.unmatched,
  };
}
