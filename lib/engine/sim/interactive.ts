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
import {
  applyMove,
  beginTurn,
  otherActor,
  promote,
  DEFAULT_MAX_MOVES,
  DEFAULT_MAX_TURNS,
  type GameOutcome,
} from "./driver";
import { legalMoves, type SimMove, type TurnContext } from "./moves";
import { PlannerPolicy } from "./planner";
import { plannerParamsForSkill } from "./difficulty";
import { promoteBest, type DecisionPolicy } from "./policy";
import { buildSimInitialState, instantiateDeck, SIM_VERSION } from "./setup";
import { describeMove, describePromotion } from "./serialize";
import { hashSeed, mulberry32 } from "./rng";
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
}

export class IllegalMoveError extends Error {}

function finish(session: GameSession, winner: "player" | "opponent" | null): void {
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
  if (session.state.turn.number >= DEFAULT_MAX_TURNS) {
    finish(session, null);
    return false;
  }
  session.turnCounts[actor] += 1;
  if (!beginTurn(session.state, actor, session.turnCounts[actor])) {
    finish(session, session.state.winner);
    return false;
  }
  if (actor === "player") {
    session.ctx = { retreated: false };
    session.status = "human_turn";
  }
  return true;
}

/** Run the AI's whole turn. Leaves status at "human_turn",
 *  "human_promotion" (its attack KO'd the human active) or "over". */
function runAiTurn(session: GameSession, record: boolean): void {
  if (!advanceTurn(session, "opponent")) return;
  const state = session.state;
  const ctx: TurnContext = { retreated: false };

  for (let i = 0; i < DEFAULT_MAX_MOVES; i++) {
    const legal = legalMoves(state, "opponent", ctx);
    const move = session.aiPolicy.chooseMove(viewFor(state, "opponent"), legal, ctx);
    const description = describeMove(state, "opponent", move);
    const result = applyMove(state, "opponent", move, ctx);
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
    // The AI's attack ended its turn; play returns to the human.
    session.aiActions = [];
    advanceTurn(session, "player");
    return;
  }

  // human_turn
  if (move.kind === "promote") throw new IllegalMoveError("No promotion is pending");
  const legal = legalMoves(state, "player", session.ctx);
  const encoded = JSON.stringify(move);
  if (!legal.some((m) => JSON.stringify(m) === encoded)) {
    throw new IllegalMoveError(`Illegal move: ${encoded}`);
  }

  const result = applyMove(state, "player", move, session.ctx);
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
