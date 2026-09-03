import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { lookupCard, lookupPrintingByLiveId, replay, solveEnergyAttribution } from "@/lib/engine";
import type { GameState, PokemonInPlay } from "@/lib/engine";
import { cardImageUrlForAnyName, cardImageUrlForName } from "@/lib/primaryCardImage";
import { cardImageSmall } from "@/lib/cardImages";
import { deriveLocks, type FrameLocks } from "./locks";

/**
 * Builds the Replay viewer's frame stream from a battle's stored
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
  /** Every card physically attached to this Pokémon, each resolved to art,
   *  for the card inspector's attached-cards row. `energy` above carries the
   *  same energy names but not their art, and `tools` is the tools half on
   *  its own; this is the two combined so the inspector doesn't need to know
   *  the difference between the attachment kinds.
   *
   *  NOT in attach order: grouped so like sits with like — all energy, then
   *  all Tools, with every copy of a card adjacent to its twins (see
   *  groupAttachments). Kinds are classified from the catalog, not from which
   *  engine array a card came from, since Tools can arrive via
   *  `attachedEnergy` — see attachmentKindRank. */
  attachedCards: { name: string; imageUrl: string | null }[];
}

export interface HandCard {
  id: string;
  name: string;
  imageUrl: string | null;
  /** False for a card the log never named — see CardInstance.unrevealed.
   *  The UI should show a face-down back for these, not the literal
   *  placeholder name. Normal for the opponent side; on the player side
   *  it should be rare-to-never, since the log names the exporting
   *  account's own cards (see the grounding discussion this is built on) —
   *  present in the type regardless, since "should be rare" isn't "can't
   *  happen" and a parser gap shouldn't render a broken card. */
  revealed: boolean;
}

export interface SideFrame {
  handle: string | null;
  active: PokemonFrame | null;
  bench: PokemonFrame[];
  /** Actual hand contents, not just the count below — see HandCard on why
   *  the opponent's is mostly unrevealed placeholders while the player's
   *  is real cards. */
  hand: HandCard[];
  handCount: number;
  deckCount: number;
  discardCount: number;
  discardTop: string | null;
  /** Image URL for the most-recently discarded card (face-up top). */
  discardTopImageUrl: string | null;
  /** The full discard pile, each card resolved to art, most-recently
   *  discarded first — the same "top of the pile" ordering discardTop
   *  above already uses (it's `side.discard`'s last element), just
   *  spelled out for every card instead of only the last one. Backs the
   *  discard-pile inspector's grid, where seeing the pile in play order
   *  (not shuffled by name or supertype) is the point. */
  discard: DiscardDrawCard[];
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

/**
 * Overlay data for a mulligan sequence: one row per mulligan taken, each
 * row the full hand that mulligan revealed. A player mulligans at most
 * once per game, in one unbroken run at the very start, so this needs no
 * "which sequence" bookkeeping the way a repeatable action would.
 *
 * The log spreads a run of mulligans across up to two actions — an initial
 * "took a mulligan" for the first, then one "took N mulligans" bundling
 * every reveal after it (see extractMulliganReveals) — but the viewer
 * reveals a row at a time regardless of which action supplied it, so
 * `buildReplayPayload` flattens both into one per-actor beat sequence, the
 * same way it stages a discard-then-draw exchange.
 */
export interface MulliganFrame {
  actor: "player" | "opponent";
  /** Rows revealed so far, oldest first. */
  rows: DiscardDrawCard[][];
  /** Row count this sequence ends at. Known from the start (mulligan_total
   *  states it outright, or there's only the one row if that action never
   *  appears) so cards can be sized once for the whole sequence instead of
   *  shrinking each time a row lands. */
  totalRows: number;
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
  /** Set on every frame that falls inside a mulligan sequence, player or
   *  opponent. Null once the last row has been shown for a full frame — see
   *  MulliganFrame. */
  mulligan: MulliganFrame | null;
  /** Derived Item / Retreat lock state per side — neither is announced by the
   *  log, so both are computed from card effects (see lib/replay/locks.ts).
   *  The viewer renders a badge on the affected side's mat. */
  locks: FrameLocks;
}

export interface ReplayPayload {
  battleId: string;
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

/**
 * Sort rank for an attached card's kind: energy first, then Pokémon Tools,
 * then anything the catalog doesn't recognize.
 *
 * Classified from the CATALOG rather than from which engine array the card
 * arrived in. The engine now routes Tools into `attachedTools` itself (see
 * isPokemonTool in the reducer), so the two agree for anything the catalog
 * knows — but that routing is a catalog lookup too, and this keeps the row's
 * ordering correct rather than inheriting whatever bucket a future action
 * type drops a card into. A card the catalog doesn't recognize sorts last
 * either way.
 */
function attachmentKindRank(name: string): number {
  const card = lookupCard(name);
  if (!card) return 2;
  if (card.supertype === "Energy") return 0;
  if (card.subtypes?.includes("Pokémon Tool")) return 1;
  return 2;
}

/**
 * Cluster a Pokémon's attachments so like sits with like: all energy before
 * all Tools, and every copy of the same card adjacent to its twins.
 *
 * Raw attach order interleaves them — a Fire, then a Psychic, then another
 * Fire renders as three unrelated cards in the inspector even though two are
 * the same card. Groups are ordered by where each name FIRST appeared rather
 * than alphabetically, so the row still reads roughly chronologically instead
 * of reshuffling every time a duplicate lands. Sort is stable and every copy
 * of a name shares one key, so copies keep their relative order.
 *
 * Exported for its own unit test: the fixtures happen to attach their Tool
 * last anyway, so only a synthetic Tool-first list actually exercises the
 * catalog-classification half of the ordering.
 */
export function groupAttachments(
  cards: { name: string; imageUrl: string | null }[],
): { name: string; imageUrl: string | null }[] {
  const firstSeen = new Map<string, number>();
  cards.forEach((c, i) => {
    if (!firstSeen.has(c.name)) firstSeen.set(c.name, i);
  });
  return cards
    .map((c) => ({ c, rank: attachmentKindRank(c.name), first: firstSeen.get(c.name)! }))
    .sort((a, b) => a.rank - b.rank || a.first - b.first)
    .map((x) => x.c);
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
  // Both attachment kinds resolve through the supertype-agnostic helper —
  // cardImageUrlForName filters to Pokémon and would silently fall back to
  // the card-back for an Energy or a Tool.
  const energyCards = mon.attachedEnergy.map((c) => ({
    name: c.name,
    imageUrl: cardImageUrlForAnyName(c.name),
  }));
  const toolCards = mon.attachedTools.map((c) => ({
    name: c.name,
    imageUrl: cardImageUrlForAnyName(c.name),
  }));
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
    tools: toolCards,
    attachedCards: groupAttachments([...energyCards, ...toolCards]),
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
    hand: side.hand.map((c) => ({
      id: c.id,
      name: c.name,
      imageUrl: c.unrevealed ? null : cardImageUrlForAnyName(c.name),
      revealed: !c.unrevealed,
    })),
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
    // Reversed so index 0 is the most recently discarded card — same card
    // discardTop names — rather than the chronological-first one, which
    // would put the game's very first discard at the grid's most prominent
    // spot instead of the pile's actual top.
    discard: [...side.discard].reverse().map((c) => ({
      name: c.name,
      imageUrl: cardImageUrlForAnyName(c.name),
    })),
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
  mulligan: MulliganFrame | null = null,
  locks: FrameLocks = {
    player: { item: false, retreat: false },
    opponent: { item: false, retreat: false },
  },
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
    mulligan,
    locks,
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

/** Card-name groups off a mulligan / mulligan_total action's
 *  `mulligan_reveals` payload, sorted by mulligan index — extractMulliganReveals
 *  in the parser already orders them this way, but a plain-data payload
 *  crossing the parse/replay boundary isn't a type-checked guarantee of that,
 *  so this re-asserts it rather than trusting the order it arrives in. */
function mulliganRevealGroups(
  payload: Record<string, unknown>,
): DiscardDrawCard[][] {
  const reveals = Array.isArray(payload.mulligan_reveals)
    ? (payload.mulligan_reveals as { index: number; cards: string[] }[])
    : [];
  return [...reveals]
    .sort((a, b) => a.index - b.index)
    .map((g) => g.cards.map(toDiscardDrawCard));
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
  battleId: string,
  battleLogRaw: string,
  playerHandle: string,
): ReplayPayload {
  const parsed = parseBattleLog(battleLogRaw);
  const normalized = normalizePerspective(parsed, playerHandle);
  // Resolve which same-printing duplicate each ambiguous energy attach belongs
  // to before building the board, so the rendered per-Pokémon energy reflects
  // the distribution the log constrains rather than piling on the first match.
  const resolveAmbiguous = solveEnergyAttribution(normalized);
  const result = replay(normalized, { resolveAmbiguous });

  // Item / Retreat lock state per snapshot — derived, since the log never
  // states either directly (see lib/replay/locks.ts).
  const locks = deriveLocks(result.states, normalized.actions);

  // Row count each actor's mulligan sequence ends at, known up front so
  // every beat in the sequence sizes its cards for the eventual total
  // instead of growing/shrinking as later rows land. A "mulligan" action
  // with no accompanying "mulligan_total" means the player mulliganed
  // exactly once; mulligan_total's own `total` field is authoritative
  // whenever it appears, since it's what the log itself claims.
  const mulliganTotalByActor: Partial<Record<"player" | "opponent", number>> = {};
  for (const a of normalized.actions) {
    if (a.actor !== "player" && a.actor !== "opponent") continue;
    if (a.action_type === "mulligan" && mulliganTotalByActor[a.actor] == null) {
      mulliganTotalByActor[a.actor] = 1;
    }
    if (a.action_type === "mulligan_total" && typeof a.payload.total === "number") {
      mulliganTotalByActor[a.actor] = a.payload.total;
    }
  }
  // Running per-actor row accumulator for the mulligan overlay. A fresh
  // array is assigned (not pushed in place) each time a row lands, so a
  // frame built from an earlier beat keeps the shorter snapshot it was
  // given rather than seeing later rows appear in it retroactively.
  const mulliganRowsByActor: Record<"player" | "opponent", DiscardDrawCard[][]> = {
    player: [],
    opponent: [],
  };

  // Frame 0 = initial state, before any action. Then one frame per action.
  const cardIds = normalized.cardIds;
  const frames: ReplayFrame[] = [];
  frames.push(
    frameFromState(
      result.initialState,
      -1,
      "Setup",
      "system",
      cardIds,
      null,
      null,
      null,
      locks.initial,
    ),
  );
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

    // Mirror of the exchange staging above, but the beats can come from
    // either of two actions ("mulligan" for the first, "mulligan_total"
    // bundling every reveal after it) rather than always one — see
    // MulliganFrame. Reading and writing mulliganRowsByActor here, in
    // action order, is what lets a "mulligan_total" action's rows build on
    // top of whatever a prior "mulligan" action already contributed.
    let mulliganBeats: (MulliganFrame | null)[] = [null];
    if (
      (action.action_type === "mulligan" || action.action_type === "mulligan_total") &&
      (actor === "player" || actor === "opponent")
    ) {
      const groups = mulliganRevealGroups(action.payload);
      const totalRows = mulliganTotalByActor[actor] ?? groups.length;
      if (groups.length > 0) {
        mulliganBeats = groups.map((cards) => {
          mulliganRowsByActor[actor] = [...mulliganRowsByActor[actor], cards];
          return { actor, rows: mulliganRowsByActor[actor], totalRows };
        });
      }
    }

    const beatCount = Math.max(stages.length, mulliganBeats.length);
    for (let i = 0; i < beatCount; i++) {
      frames.push(
        frameFromState(
          state,
          idx,
          action.raw_text,
          actor,
          cardIds,
          lastPlayedTrainer,
          i < stages.length ? stages[i] : null,
          i < mulliganBeats.length ? mulliganBeats[i] : null,
          locks.perState[idx],
        ),
      );
    }
  });

  // Primary attacker per side = highest-damage Pokémon over the whole
  // battle. Mirrors the existing /battles/[id] header logic but reads from
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
    battleId,
    playerHandle: normalized.player_handle,
    opponentHandle: normalized.opponent_handle,
    playerPrimaryName: topAttacker(dmgByActor.player),
    opponentPrimaryName: topAttacker(dmgByActor.opponent),
    frames,
    unmatchedLines: normalized.unmatched,
  };
}
