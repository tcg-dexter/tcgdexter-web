// Interactive game session — human vs the AI player (Milestone B).
//
// Stateless-server design: the engine is deterministic and seeded, so the
// TRANSCRIPT IS THE STATE. {seed, decks, skill, moves[]} rebuilds the
// exact game; the API layer replays it on every request instead of
// holding sessions. Human = sides.player, AI = sides.opponent.
//
// Status machine: "human_setup" (the human places their opening board;
// the AI's is placed only once they commit, so neither sees the other's) →
// "human_turn" (awaiting a SimMove) → applying it may KO
// the AI's active (AI promotes instantly via its policy) or end the turn
// (the AI's whole reply turn runs, possibly leaving "human_promotion"
// when its attack KO'd the human's active) → back to "human_turn", until
// "over".

import type { GameState } from "../types";
import { turnQualityFlags } from "@/lib/ml/features/labels";
import type { TurnFeatures, TurnQualityFlags } from "@/lib/ml/features/types";
import {
  applyMove,
  beginTurn,
  otherActor,
  promote,
  DEFAULT_MAX_MOVES,
  DEFAULT_MAX_TURNS,
  type GameOutcome,
} from "./driver";
import { computeDamage, legalMoves, type SimMove, type TurnContext } from "./moves";
import { isLegalHumanMove } from "./validate";
import { runCheckup } from "./conditions";
import { resolveKnockouts } from "./damage";
import { PlannerPolicy, type StateEvaluator } from "./planner";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";
import { plannerParamsForSkill } from "./difficulty";
import { promoteBest, type DecisionPolicy } from "./policy";
import {
  autoPlaceBoard,
  buildSimInitialState,
  instantiateDeck,
  isBasic,
  rankOpeningBasics,
  toPokemonInPlay,
  SIM_VERSION,
} from "./setup";
import { describeMove, describePromotion } from "./serialize";
import { isSupporter, trainerSpec } from "./trainers";
import { hashSeed, mulberry32, type Rng } from "./rng";
import { viewFor } from "./view";
import {
  BattleLogWriter,
  logGameEnd,
  logMove,
  logPromotion,
  logSetup,
  logTurnStart,
  sanitizeHandle,
  snapshotMove,
  type LogHandles,
} from "./battleLog";

/* ─── Transcript ────────────────────────────────────────────────── */

/** Opening-board placement, before turn 1. Not `SimMove`s: they never appear
 *  in `legalMoves` and the headless sim auto-places, so they live here with
 *  `promote` as decisions the SESSION owns rather than the rules engine. */
export type SetupMove =
  | { kind: "setup_active"; cardId: string }
  | { kind: "setup_bench"; cardId: string }
  | { kind: "setup_reset" }
  | { kind: "setup_done" };

export type InteractiveMove =
  | SimMove
  | { kind: "promote"; benchIndex: number }
  | SetupMove;

export interface TranscriptMove {
  actor: "human" | "ai";
  move: InteractiveMove;
}

export interface GameTranscript {
  sim_version: number;
  seed: number;
  deck_human: string;
  deck_ai: string;
  /** Difficulty dial 0..1 (see difficulty.ts presets). */
  skill: number;
  human_first: boolean;
  moves: TranscriptMove[];
  /** Display names in the emitted battle log. Recorded so a rebuilt
   *  session renders byte-identical text — the log is a stored artifact,
   *  and it must not change because a profile was renamed later. */
  handles?: LogHandles;
  /** Labels for the persisted row. Display-only, and carried here because
   *  the server is stateless: the transcript is the only thing that
   *  survives from the game's start to the move that ends it. */
  meta?: {
    user_deck_name?: string | null;
    ai_deck_name?: string | null;
    saved_deck_id?: string | null;
  };
}

/* ─── Session ───────────────────────────────────────────────────── */

export type SessionStatus = "human_setup" | "human_turn" | "human_promotion" | "over";

export interface AiAction {
  turn: number;
  description: string;
}

/** One Phase-1 feature row (+ quality flags) per completed turn, from the
 *  human's perspective — the post-game review feeds these straight into
 *  buildCoachReport / winProbCurve. */
export type LoggedTurn = TurnFeatures & TurnQualityFlags;

interface TurnStats {
  actor: "player" | "opponent";
  turnNumber: number;
  playerTurnNumber: number;
  benchStart: number;
  attacked: 0 | 1;
  attackDamage: number;
  energyAttached: number;
  supporters: number;
  items: number;
  evolutions: number;
  retreats: number;
  retreatEnergy: number;
  abilities: number;
  kos: number;
  prizesTaken: number;
}

export interface GameSession {
  state: GameState;
  transcript: GameTranscript;
  status: SessionStatus;
  /** Human's current-turn context (one retreat per turn). */
  ctx: TurnContext;
  outcome: GameOutcome | null;
  /** AI actions since the last human decision point (for the UI feed). */
  aiActions: AiAction[];
  turnCounts: { player: number; opponent: number };
  aiPolicy: DecisionPolicy;
  /** Completed-turn feature rows for the post-game review. */
  turnLog: LoggedTurn[];
  turnStats: TurnStats | null;
  /** The session's rng stream (setup + shuffle effects). Rebuilds consume
   *  it in the same order, keeping transcripts deterministic. */
  rng: Rng;
  /** When status === "human_promotion", what to resume once the human
   *  promotes. Re-derived deterministically during transcript replay
   *  (set at the pause point, which regenerates identically). */
  promotionResume: PromotionResume;
  /** TCG Live-format log of the game so far, written as it is played.
   *  Rebuilt from scratch on every replay, so it never needs storing in
   *  the transcript — the transcript already determines it. */
  log: BattleLogWriter;
}

/** Where to resume after a human promotion choice:
 *  - attack_ko           AI's attack KO'd the human active → Checkup(opp) then human turn.
 *  - checkup_before_ai   Checkup after the human's turn KO'd them → run the AI turn body.
 *  - checkup_before_human Checkup after the AI's turn KO'd them → begin the human turn.
 *  - continue_human_turn Human's own ability self-KO (turn didn't end) → keep playing.
 *  - self_ko_end_turn    Human's own attack/confusion self-KO ended the turn → run the AI turn. */
type PromotionResume =
  | "attack_ko"
  | "checkup_before_ai"
  | "checkup_before_human"
  | "continue_human_turn"
  | "self_ko_end_turn"
  | null;

export class IllegalMoveError extends Error {}

/** Close the open turn's stats into a LoggedTurn row (post-KO-resolution
 *  end-of-turn snapshot, matching Phase-1 extraction semantics). */
function closeTurn(session: GameSession): void {
  const s = session.turnStats;
  if (!s) return;
  session.turnStats = null;
  const state = session.state;
  const features: TurnFeatures = {
    turn_number: s.turnNumber,
    player_turn_number: s.playerTurnNumber,
    actor: s.actor,
    attacked: s.attacked,
    attack_damage: s.attackDamage,
    energy_attached: s.energyAttached,
    supporter_played: s.supporters > 0 ? 1 : 0,
    items_played: s.items,
    tools_played: 0,
    stadium_played: 0,
    evolutions: s.evolutions,
    retreats: s.retreats,
    retreat_energy_discarded: s.retreatEnergy,
    abilities_used: s.abilities,
    kos_scored: s.kos,
    prizes_taken: s.prizesTaken,
    prizes_player: state.prizesTaken.player,
    prizes_opponent: state.prizesTaken.opponent,
    prize_diff: state.prizesTaken.player - state.prizesTaken.opponent,
    bench_player: state.sides.player.bench.length,
    bench_opponent: state.sides.opponent.bench.length,
    hand_player: state.sides.player.hand.length,
    // Sim games have perfect own-hand knowledge (unlike parsed logs).
    hand_player_known: state.sides.player.hand.length,
    hand_opponent: state.sides.opponent.hand.length,
    bench_delta: state.sides[s.actor].bench.length - s.benchStart,
  };
  session.turnLog.push({ ...features, ...turnQualityFlags(features, state) });
}

/** applyMove + turn-stat accounting (attack damage, KOs, prizes). */
function applyTracked(
  session: GameSession,
  actor: "player" | "opponent",
  move: SimMove,
  ctx: TurnContext,
) {
  const state = session.state;
  const s = session.turnStats;
  if (s) {
    const side = state.sides[actor];
    switch (move.kind) {
      case "attach":
        s.energyAttached += 1;
        break;
      case "evolve":
        s.evolutions += 1;
        break;
      case "retreat":
        s.retreats += 1;
        s.retreatEnergy += Math.min(
          side.active?.card.catalog?.retreat_cost ?? 0,
          side.active?.attachedEnergy.length ?? 0,
        );
        break;
      case "cycle_supporter":
        s.supporters += 1;
        break;
      case "cycle_item":
        s.items += 1;
        break;
      case "play_trainer": {
        const card = side.hand.find((c) => c.id === move.cardId);
        if (card && isSupporter(card)) s.supporters += 1;
        else s.items += 1;
        break;
      }
      case "effect": {
        // Trainer-triggered effects count as supporter/item plays; ability
        // triggers (no hand card) fall through and are counted as abilities.
        const card = side.hand.find((c) => c.id === move.sourceId);
        if (card) {
          if (isSupporter(card)) s.supporters += 1;
          else s.items += 1;
        } else {
          s.abilities += 1;
        }
        break;
      }
      case "use_ability":
        s.abilities += 1;
        break;
      case "attach_tool":
      case "play_stadium":
      case "use_stadium":
        s.items += 1;
        break;
      case "attack": {
        s.attacked = 1;
        const attacker = side.active;
        const defender = state.sides[otherActor(actor)].active;
        const attack = attacker?.card.catalog?.attacks[move.attackIndex];
        if (attacker && defender && attack) {
          s.attackDamage += computeDamage(attacker, attack, defender);
        }
        break;
      }
    }
  }
  const prizesBefore = state.prizesTaken[actor];
  // Card names and targets have to be read BEFORE the move mutates them.
  const logSnap = snapshotMove(session.log, state, actor, move);
  const result = applyMove(state, actor, move, ctx, session.rng);
  logMove(session.log, state, actor, logSnap);
  if (s) {
    const delta = state.prizesTaken[actor] - prizesBefore;
    s.prizesTaken += delta;
    if (delta > 0) s.kos += 1;
  }
  return result;
}

function finish(session: GameSession, winner: "player" | "opponent" | null): void {
  closeTurn(session);
  const state = session.state;
  let finalWinner = winner ?? state.winner;
  if (finalWinner === null) {
    if (state.prizesTaken.player > state.prizesTaken.opponent) finalWinner = "player";
    else if (state.prizesTaken.opponent > state.prizesTaken.player) finalWinner = "opponent";
  }
  session.status = "over";
  logGameEnd(session.log, finalWinner, state.endReason);
  session.outcome = {
    winner: finalWinner,
    endReason: (state.endReason as GameOutcome["endReason"]) ?? "turn_cap",
    turns: state.turn.number,
    prizesTaken: { ...state.prizesTaken },
    firstKoTurn: null,
  };
}

/** Advance to the given actor's turn; ends the game on deck-out/turn cap.
 *  Returns true when the turn began normally. */
function advanceTurn(session: GameSession, actor: "player" | "opponent"): boolean {
  closeTurn(session);
  if (session.state.turn.number >= DEFAULT_MAX_TURNS) {
    finish(session, null);
    return false;
  }
  session.turnCounts[actor] += 1;
  const handBefore = new Set(session.state.sides[actor].hand.map((c) => c.id));
  if (!beginTurn(session.state, actor, session.turnCounts[actor])) {
    // Deck-out: the turn header still belongs in the log, then the result.
    logTurnStart(session.log, actor, null, "player");
    finish(session, session.state.winner);
    return false;
  }
  logTurnStart(
    session.log,
    actor,
    session.state.sides[actor].hand.find((c) => !handBefore.has(c.id)) ?? null,
    "player",
  );
  session.turnStats = {
    actor,
    turnNumber: session.state.turn.number,
    playerTurnNumber: session.turnCounts[actor],
    benchStart: session.state.sides[actor].bench.length,
    attacked: 0,
    attackDamage: 0,
    energyAttached: 0,
    supporters: 0,
    items: 0,
    evolutions: 0,
    retreats: 0,
    retreatEnergy: 0,
    abilities: 0,
    kos: 0,
    prizesTaken: 0,
  };
  if (actor === "player") {
    session.ctx = { retreated: false };
    session.status = "human_turn";
  }
  return true;
}

/** Auto-promote the AI after a KO (via its policy), logging the promotion
 *  to the action feed. */
function autoPromoteAi(session: GameSession): void {
  const state = session.state;
  promote(state, "opponent", session.aiPolicy.choosePromotion(viewFor(state, "opponent")));
  logPromotion(session.log, state, "opponent");
  session.aiActions.push({
    turn: state.turn.number,
    description: describePromotion(state.sides.opponent.active?.card.name ?? "a Pokémon"),
  });
}

/** Pokémon Checkup between turns: conditions on both actives, then KO
 *  resolution. The AI auto-promotes; if the HUMAN's active was KO'd, the
 *  game pauses for their promotion choice (status → human_promotion, with
 *  the resume recorded). Returns false when the game ended OR paused. */
function betweenTurns(session: GameSession, justActed: "player" | "opponent"): boolean {
  const state = session.state;
  if (state.turn.number === 0) return true; // no Checkup before the game's first turn
  // Only open a Checkup section when something is actually there to resolve;
  // TCG Live omits the header on an empty Checkup and an empty section would
  // be noise in every single turn.
  const conditioned = [state.sides.player.active, state.sides.opponent.active].some(
    (m) => m != null && m.conditions.length > 0,
  );
  const koBefore = new Set(
    (["player", "opponent"] as const).flatMap((a) =>
      [state.sides[a].active].filter((m) => m != null).map((m) => `${a}:${m!.id}:${m!.card.name}`),
    ),
  );
  if (conditioned) session.log.checkup();
  runCheckup(state, justActed, session.rng);
  const ko = resolveKnockouts(state);
  if (conditioned) {
    for (const key of Array.from(koBefore)) {
      const [a, id, name] = key.split(":");
      const actor = a as "player" | "opponent";
      const side = state.sides[actor];
      const alive = [side.active, ...side.bench].some((m) => m?.id === id);
      if (!alive) session.log.line(`${session.log.handle(actor)}'s ${name} was Knocked Out!`);
    }
  }
  if (ko.winner) {
    finish(session, ko.winner);
    return false;
  }
  if (ko.pendingPromotions.includes("opponent")) autoPromoteAi(session);
  if (ko.pendingPromotions.includes("player")) {
    session.status = "human_promotion";
    session.promotionResume = justActed === "player" ? "checkup_before_ai" : "checkup_before_human";
    return false; // pause for the human's choice
  }
  return true;
}

/** Run the AI's whole turn. Leaves status at "human_turn",
 *  "human_promotion" or "over". */
function runAiTurn(session: GameSession, record: boolean): void {
  // Checkup after the human's just-ended turn, before the AI begins.
  if (!betweenTurns(session, "player")) return;
  runAiTurnBody(session, record);
}

/** The AI's turn proper (after the pre-turn Checkup has run). Split out so a
 *  checkup-KO promotion before the AI's turn can resume here. */
function runAiTurnBody(session: GameSession, record: boolean): void {
  if (!advanceTurn(session, "opponent")) return;
  const state = session.state;
  const ctx: TurnContext = { retreated: false };

  for (let i = 0; i < DEFAULT_MAX_MOVES; i++) {
    const legal = legalMoves(state, "opponent", ctx);
    const move = session.aiPolicy.chooseMove(viewFor(state, "opponent", ctx), legal, ctx);
    const description = describeMove(state, "opponent", move);
    const result = applyTracked(session, "opponent", move, ctx);
    session.aiActions.push({ turn: state.turn.number, description });
    if (record) session.transcript.moves.push({ actor: "ai", move });

    if (state.winner !== null) {
      finish(session, state.winner);
      return;
    }
    // Auto-promote the AI's own side FIRST (a recoil/self-KO can fall in the
    // same move that KO'd the human's active), then hand the choice over.
    if (result.pendingPromotions.includes("opponent")) {
      promote(state, "opponent", session.aiPolicy.choosePromotion(viewFor(state, "opponent")));
    }
    if (result.pendingPromotions.includes("player")) {
      // The AI's attack KO'd the human active; they choose the replacement,
      // then the Checkup runs and their turn begins (resume: attack_ko).
      session.status = "human_promotion";
      session.promotionResume = "attack_ko";
      return;
    }
    if (result.turnEnded) break;
  }

  // Checkup after the AI's turn, before the human's begins.
  if (!betweenTurns(session, "opponent")) return;
  advanceTurn(session, "player");
}

/* ─── Public API ────────────────────────────────────────────────── */

export interface StartOptions {
  deckHuman: string;
  deckAi: string;
  /** Difficulty dial 0..1. */
  skill: number;
  seed?: number | string;
  /** Display names for the emitted battle log. Set HERE rather than on the
   *  session afterwards: the writer is built at boot, so a late assignment
   *  produces a log the rebuilt session does not reproduce. */
  handles?: LogHandles;
  /** Labels recorded alongside the persisted game. Display-only. */
  meta?: GameTranscript["meta"];
}

export function startGame(options: StartOptions): GameSession {
  const seed =
    typeof options.seed === "string"
      ? hashSeed(options.seed)
      : options.seed ?? (Date.now() >>> 0);
  // The coin flip is re-derived inside bootSession from the same seed so
  // startGame and rebuildSession consume the rng stream identically.
  const transcript: GameTranscript = {
    sim_version: SIM_VERSION,
    seed,
    deck_human: options.deckHuman,
    deck_ai: options.deckAi,
    skill: options.skill,
    human_first: mulberry32(seed)() < 0.5,
    moves: [],
    handles: {
      // "Player" rather than "You": the log grammar is third-person
      // ("<handle>'s Turn", "<handle> wins."), and "You wins." reads as a bug.
      player: sanitizeHandle(options.handles?.player ?? "", "Player"),
      opponent: sanitizeHandle(options.handles?.opponent ?? "", "Dexter"),
    },
    ...(options.meta ? { meta: options.meta } : {}),
  };
  return bootSession(transcript);
}

// The interactive AI opponent plays with the same promoted board-aware value
// model as self-play and the duel harness — resolved once, lazily, and
// memoized so rebuildSession (called per request to regenerate AI replies)
// neither re-reads the ~650 KB artifact nor drifts from the model the human
// is being scored against. `null` means no artifact is live, in which case
// PlannerPolicy uses its built-in heuristic fallback (the previous behaviour).
// Baking the current registry's model in at boot/rebuild time keeps replay
// deterministic as long as the model isn't swapped mid-session; a swap is a
// bigger break already guarded by sim_version.
let cachedEvaluator: StateEvaluator | null | undefined;
function botEvaluator(): StateEvaluator | null {
  if (cachedEvaluator === undefined) cachedEvaluator = createBotEvaluator();
  return cachedEvaluator;
}

function bootSession(transcript: GameTranscript): GameSession {
  // Canonical rng stream: one draw for the opening coin, then setup
  // shuffles. Any deviation would desync transcript replays.
  const rng = mulberry32(transcript.seed);
  rng(); // the coin flip recorded as transcript.human_first
  // Local id prefixes make card/mon ids reproducible across rebuilds —
  // recorded moves reference them (see instantiateDeck).
  const deckHuman = instantiateDeck(transcript.deck_human, "h");
  const deckAi = instantiateDeck(transcript.deck_ai, "a");
  const state = buildSimInitialState(
    deckHuman,
    deckAi,
    rng,
    transcript.human_first ? "player" : "opponent",
    true, // the human places their own opening board
  );
  const session: GameSession = {
    state,
    transcript,
    status: "human_setup",
    ctx: { retreated: false },
    outcome: null,
    aiActions: [],
    turnCounts: { player: 0, opponent: 0 },
    turnLog: [],
    turnStats: null,
    rng,
    promotionResume: null,
    log: new BattleLogWriter({
      player: sanitizeHandle(transcript.handles?.player ?? "", "You"),
      opponent: sanitizeHandle(transcript.handles?.opponent ?? "", "Dexter"),
    }),
    aiPolicy: new PlannerPolicy({
      params: plannerParamsForSkill(transcript.skill),
      seed: (transcript.seed ^ 0x5eed) >>> 0,
      ...((): { evaluate?: StateEvaluator } => {
        const evaluate = botEvaluator();
        return evaluate ? { evaluate } : {};
      })(),
    }),
  };
  return session;
}

/* ─── Opening setup ─────────────────────────────────────────────── */

/** Board placement is over; hand off to whoever goes first. */
function startPlay(session: GameSession): void {
  // The AI places only NOW. Both players choose their opening board without
  // seeing the other's, as in the real game — placing it at buildSimInitialState
  // would have shown the human the AI's whole board first. Placement consumes
  // no rng, so the seeded stream (and replay) is unaffected.
  autoPlaceBoard(session.state.sides.opponent);
  // Both boards exist now, so the Setup section can be written in one go —
  // which is also the order TCG Live writes it.
  logSetup(
    session.log,
    session.state,
    session.transcript.human_first ? "player" : "opponent",
    "player", // the human owns this log; a real log reveals only its owner's hand
  );
  session.status = "human_turn";
  if (session.transcript.human_first) {
    advanceTurn(session, "player");
  } else {
    // The AI must not take its first turn against an empty board, which is
    // why bootSession pauses BEFORE this rather than after buildSimInitialState.
    runAiTurn(session, true);
  }
}

/** The human's opening-board choices: their Active, then any Basics they
 *  want Benched. Every Basic in hand is offered — the ranking only decides
 *  the ORDER, so a caller taking the first option reproduces the headless
 *  auto-placement exactly (see rankOpeningBasics). */
export function setupOptions(session: GameSession): SetupMove[] {
  const side = session.state.sides.player;
  const library = [...side.hand, ...side.deck, ...side.prizes];
  const basics = rankOpeningBasics(side.hand, library);
  if (!side.active) {
    return basics.map((c) => ({ kind: "setup_active" as const, cardId: c.id }));
  }
  const out: SetupMove[] = [];
  if (side.bench.length < 5) {
    out.push(...basics.map((c) => ({ kind: "setup_bench" as const, cardId: c.id })));
  }
  // `setup_done` sits after the Bench options and before `setup_reset` so a
  // naive agent that always takes options[0] benches everything and then
  // finishes, rather than looping on reset forever.
  out.push({ kind: "setup_done" }, { kind: "setup_reset" });
  return out;
}

/** Take the top-ranked choice at every step — the same board the headless
 *  sim would have built. Used by tests and by the UI's auto-place button. */
export function autoSetup(session: GameSession): void {
  while (session.status === "human_setup") {
    const options = setupOptions(session);
    if (options.length === 0) throw new IllegalMoveError("No legal opening board");
    applyHumanMove(session, options[0]);
  }
}

export function isSetupMove(move: InteractiveMove): move is SetupMove {
  return move.kind.startsWith("setup_");
}

function applySetupMove(session: GameSession, move: SetupMove): void {
  const side = session.state.sides.player;
  const takeBasic = (cardId: string) => {
    const idx = side.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new IllegalMoveError("That card is not in your hand");
    const card = side.hand[idx];
    if (!isBasic(card)) throw new IllegalMoveError("Only Basic Pokémon can be placed");
    side.hand.splice(idx, 1);
    return card;
  };

  switch (move.kind) {
    case "setup_active":
      if (side.active) throw new IllegalMoveError("Active Pokémon already chosen");
      side.active = toPokemonInPlay(takeBasic(move.cardId), 0);
      return;
    case "setup_bench":
      if (!side.active) throw new IllegalMoveError("Choose your Active Pokémon first");
      if (side.bench.length >= 5) throw new IllegalMoveError("Bench is full");
      side.bench.push(toPokemonInPlay(takeBasic(move.cardId), 0));
      return;
    case "setup_reset":
      // Everything goes back to hand in placement order. Replay applies the
      // same recorded moves, so the resulting hand order is deterministic.
      for (const mon of [side.active, ...side.bench]) {
        if (mon) side.hand.push(mon.card);
      }
      side.active = null;
      side.bench = [];
      return;
    case "setup_done":
      if (!side.active) throw new IllegalMoveError("You must choose an Active Pokémon");
      startPlay(session);
      return;
  }
}

/** Apply one human decision (a turn move or a promotion). Advances the
 *  game — including the AI's reply turn(s) — to the next human decision
 *  point or the end of the game. Throws IllegalMoveError on bad input. */
export function applyHumanMove(session: GameSession, move: InteractiveMove, record = true): void {
  if (session.status === "over") throw new IllegalMoveError("Game is over");
  const state = session.state;

  if (session.status === "human_setup") {
    if (!isSetupMove(move)) throw new IllegalMoveError("Place your opening board first");
    applySetupMove(session, move);
    if (record) session.transcript.moves.push({ actor: "human", move });
    return;
  }
  if (isSetupMove(move)) throw new IllegalMoveError("Your board is already set up");

  if (session.status === "human_promotion") {
    if (move.kind !== "promote") throw new IllegalMoveError("A promotion choice is required");
    if (move.benchIndex < 0 || move.benchIndex >= state.sides.player.bench.length) {
      throw new IllegalMoveError("Invalid bench index");
    }
    promote(state, "player", move.benchIndex);
    logPromotion(session.log, state, "player");
    if (record) session.transcript.moves.push({ actor: "human", move });
    const resume = session.promotionResume;
    session.promotionResume = null;
    switch (resume) {
      case "continue_human_turn":
        // The human's own ability self-KO'd mid-turn; they keep playing.
        session.status = "human_turn";
        return;
      case "checkup_before_ai":
        // Checkup after the human's turn KO'd them; run the AI's turn.
        session.aiActions = [];
        runAiTurnBody(session, record);
        return;
      case "checkup_before_human":
        // Checkup after the AI's turn KO'd them; begin the human's turn.
        advanceTurn(session, "player");
        return;
      case "self_ko_end_turn":
        // The human's own attack/confusion self-KO ended their turn.
        session.aiActions = [];
        runAiTurn(session, record);
        return;
      case "attack_ko":
      default:
        // The AI's attack ended its turn; Checkup, then the human's turn.
        session.aiActions = [];
        if (!betweenTurns(session, "opponent")) return;
        advanceTurn(session, "player");
        return;
    }
  }

  // human_turn
  if (move.kind === "promote") throw new IllegalMoveError("No promotion is pending");
  if (!isLegalHumanMove(state, "player", session.ctx, move)) {
    throw new IllegalMoveError(`Illegal move: ${JSON.stringify(move)}`);
  }

  const result = applyTracked(session, "player", move, session.ctx);
  if (record) session.transcript.moves.push({ actor: "human", move });

  if (state.winner !== null) {
    finish(session, state.winner);
    return;
  }
  if (result.pendingPromotions.includes("opponent")) {
    const idx = session.aiPolicy.choosePromotion(viewFor(state, "opponent"));
    promote(state, "opponent", idx);
    const promoted = state.sides.opponent.active;
    session.aiActions.push({
      turn: state.turn.number,
      description: describePromotion(promoted?.card.name ?? "a Pokémon"),
    });
    if (record) session.transcript.moves.push({ actor: "ai", move: { kind: "promote", benchIndex: idx } });
  }
  if (result.pendingPromotions.includes("player")) {
    // The human's OWN effect KO'd their active (Dusknoir's Cursed Blast, a
    // Confusion self-hit). They choose the replacement; if the move ended
    // the turn, the AI plays next, otherwise the human keeps going.
    session.status = "human_promotion";
    session.promotionResume = result.turnEnded ? "self_ko_end_turn" : "continue_human_turn";
    return;
  }
  if (result.turnEnded) {
    session.aiActions = [];
    runAiTurn(session, record);
  }
}

/** Rebuild a session from its transcript (the stateless-server path).
 *  Recorded AI moves are cross-checked structurally: human moves replay
 *  through the same validation; AI turns regenerate deterministically
 *  from the seed, so the transcript's AI entries are redundant-but-kept
 *  for auditability. */
export function rebuildSession(transcript: GameTranscript): GameSession {
  if (transcript.sim_version !== SIM_VERSION) {
    throw new IllegalMoveError(
      `Transcript sim_version ${transcript.sim_version} does not match engine ${SIM_VERSION}`,
    );
  }
  const header: GameTranscript = { ...transcript, moves: [] };
  const session = bootSession(header);
  for (const entry of transcript.moves) {
    if (entry.actor !== "human") continue; // AI regenerates deterministically
    if (session.status === "over") break;
    applyHumanMove(session, entry.move, true);
  }
  return session;
}

/** The game so far as a TCG Live-format battle log. Rebuilt from the
 *  transcript on every replay, so it is always consistent with the moves —
 *  there is no second source of truth to drift. */
export function battleLogText(session: GameSession): string {
  return session.log.render();
}

/** Human's currently legal decisions, for the client UI. */
export function humanOptions(session: GameSession): InteractiveMove[] {
  if (session.status === "human_setup") return setupOptions(session);
  if (session.status === "human_turn") {
    // expandAuto: a person choosing which cards come out of their own deck is
    // the whole point of a search card. The AI keeps the single auto-picked
    // move (see legalMoves) so its strength and latency are unchanged.
    return legalMoves(session.state, "player", session.ctx, true);
  }
  if (session.status === "human_promotion") {
    return session.state.sides.player.bench.map((_, i) => ({
      kind: "promote" as const,
      benchIndex: i,
    }));
  }
  return [];
}
