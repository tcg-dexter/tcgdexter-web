// Interactive game session — human vs the AI player (Milestone B).
//
// Stateless-server design: the engine is deterministic and seeded, so the
// TRANSCRIPT IS THE STATE. {seed, decks, skill, moves[]} rebuilds the
// exact game; the API layer replays it on every request instead of
// holding sessions. Human = sides.player, AI = sides.opponent.
//
// Status machine: "human_turn" (awaiting a SimMove) → applying it may KO
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
import { PlannerPolicy } from "./planner";
import { plannerParamsForSkill } from "./difficulty";
import { promoteBest, type DecisionPolicy } from "./policy";
import { buildSimInitialState, instantiateDeck, SIM_VERSION } from "./setup";
import { describeMove, describePromotion } from "./serialize";
import { isSupporter, trainerSpec } from "./trainers";
import { hashSeed, mulberry32, type Rng } from "./rng";
import { viewFor } from "./view";

/* ─── Transcript ────────────────────────────────────────────────── */

export type InteractiveMove = SimMove | { kind: "promote"; benchIndex: number };

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
}

/* ─── Session ───────────────────────────────────────────────────── */

export type SessionStatus = "human_turn" | "human_promotion" | "over";

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
}

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
      case "use_ability":
        s.abilities += 1;
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
  const result = applyMove(state, actor, move, ctx, session.rng);
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
  if (!beginTurn(session.state, actor, session.turnCounts[actor])) {
    finish(session, session.state.winner);
    return false;
  }
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

/** Pokémon Checkup between turns: conditions on both actives, then KO
 *  resolution. Both sides auto-promote here (a between-turns poison/burn KO
 *  doesn't pause for a human promotion choice — a minor v1 simplification;
 *  attack KOs still prompt). Returns false when the game ended. */
function betweenTurns(session: GameSession, justActed: "player" | "opponent"): boolean {
  const state = session.state;
  if (state.turn.number === 0) return true; // no Checkup before the game's first turn
  runCheckup(state, justActed, session.rng);
  const ko = resolveKnockouts(state);
  if (ko.winner) {
    finish(session, ko.winner);
    return false;
  }
  for (const side of ko.pendingPromotions) {
    promote(state, side, session.aiPolicy.choosePromotion(viewFor(state, side)));
    if (side === "opponent") {
      session.aiActions.push({
        turn: state.turn.number,
        description: describePromotion(state.sides.opponent.active?.card.name ?? "a Pokémon"),
      });
    }
  }
  return true;
}

/** Run the AI's whole turn. Leaves status at "human_turn",
 *  "human_promotion" (its attack KO'd the human active) or "over". */
function runAiTurn(session: GameSession, record: boolean): void {
  // Checkup after the human's just-ended turn, before the AI begins.
  if (!betweenTurns(session, "player")) return;
  if (!advanceTurn(session, "opponent")) return;
  const state = session.state;
  const ctx: TurnContext = { retreated: false };

  for (let i = 0; i < DEFAULT_MAX_MOVES; i++) {
    const legal = legalMoves(state, "opponent", ctx);
    const move = session.aiPolicy.chooseMove(viewFor(state, "opponent"), legal, ctx);
    const description = describeMove(state, "opponent", move);
    const result = applyTracked(session, "opponent", move, ctx);
    session.aiActions.push({ turn: state.turn.number, description });
    if (record) session.transcript.moves.push({ actor: "ai", move });

    if (state.winner !== null) {
      finish(session, state.winner);
      return;
    }
    if (result.pendingPromotion === "player") {
      // Human decides; their turn begins after the promotion is applied.
      session.status = "human_promotion";
      return;
    }
    if (result.pendingPromotion === "opponent") {
      // Defensive — cannot happen during the AI's own turn.
      promote(state, "opponent", session.aiPolicy.choosePromotion(viewFor(state, "opponent")));
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
  };
  return bootSession(transcript);
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
  );
  const session: GameSession = {
    state,
    transcript,
    status: "human_turn",
    ctx: { retreated: false },
    outcome: null,
    aiActions: [],
    turnCounts: { player: 0, opponent: 0 },
    turnLog: [],
    turnStats: null,
    rng,
    aiPolicy: new PlannerPolicy({
      params: plannerParamsForSkill(transcript.skill),
      seed: (transcript.seed ^ 0x5eed) >>> 0,
    }),
  };
  if (transcript.human_first) {
    advanceTurn(session, "player");
  } else {
    runAiTurn(session, true);
  }
  return session;
}

/** Apply one human decision (a turn move or a promotion). Advances the
 *  game — including the AI's reply turn(s) — to the next human decision
 *  point or the end of the game. Throws IllegalMoveError on bad input. */
export function applyHumanMove(session: GameSession, move: InteractiveMove, record = true): void {
  if (session.status === "over") throw new IllegalMoveError("Game is over");
  const state = session.state;

  if (session.status === "human_promotion") {
    if (move.kind !== "promote") throw new IllegalMoveError("A promotion choice is required");
    if (move.benchIndex < 0 || move.benchIndex >= state.sides.player.bench.length) {
      throw new IllegalMoveError("Invalid bench index");
    }
    promote(state, "player", move.benchIndex);
    if (record) session.transcript.moves.push({ actor: "human", move });
    // The AI's attack ended its turn; run the between-turns Checkup, then
    // play returns to the human.
    session.aiActions = [];
    if (!betweenTurns(session, "opponent")) return;
    advanceTurn(session, "player");
    return;
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
  if (result.pendingPromotion === "opponent") {
    const idx = session.aiPolicy.choosePromotion(viewFor(state, "opponent"));
    promote(state, "opponent", idx);
    const promoted = state.sides.opponent.active;
    session.aiActions.push({
      turn: state.turn.number,
      description: describePromotion(promoted?.card.name ?? "a Pokémon"),
    });
    if (record) session.transcript.moves.push({ actor: "ai", move: { kind: "promote", benchIndex: idx } });
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

/** Human's currently legal decisions, for the client UI. */
export function humanOptions(session: GameSession): InteractiveMove[] {
  if (session.status === "human_turn") {
    return legalMoves(session.state, "player", session.ctx);
  }
  if (session.status === "human_promotion") {
    return session.state.sides.player.bench.map((_, i) => ({
      kind: "promote" as const,
      benchIndex: i,
    }));
  }
  return [];
}
