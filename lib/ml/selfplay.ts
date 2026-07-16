// Self-play dataset generation for the next-action policy model.
//
// Wraps the planner in a RecordingPolicy: at every decision point of both
// players it captures the encoded state, every legal candidate's action
// features, and which one the planner chose; after the game every decision
// is labeled with the outcome from its actor's perspective. The sim engine
// is fully seeded, so a (seed, games, decks, skills) tuple reproduces the
// dataset byte-for-byte — the CLI (scripts/ml/selfplay.ts) keys idempotency
// on exactly that tuple.
//
// Deliberately NOT recorded: forced promotion choices (a different decision
// type — add as its own table when the policy learns promotions) and human
// games from /admin-tools/play (a verification GUI, per project decision).

import {
  PlannerPolicy,
  hashSeed,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
  type DecisionPolicy,
  type SimMove,
  type TurnContext,
} from "@/lib/engine/sim";
import type { StateEvaluator } from "@/lib/engine/sim";
import type { PlayerView } from "@/lib/engine/sim/view";
import { encodeActionFeatures, encodeStateFeatures } from "./features/policy";
import { createBotEvaluator } from "./botEvaluator";

export interface SelfPlayCandidate {
  kind: string;
  features: number[];
}

export interface SelfPlayDecision {
  actor: "player" | "opponent";
  /** Global (1-indexed) and per-actor turn numbers at decision time. */
  turnNumber: number;
  playerTurnNumber: number;
  /** Ordinal of this decision within its game (both actors, 0-indexed). */
  decisionIndex: number;
  /** Acting side's planner skill for this game. */
  skill: number;
  stateFeatures: number[];
  candidates: SelfPlayCandidate[];
  /** Index into candidates of the chosen move (deep-equality match). */
  chosenIndex: number;
  chosenKind: string;
  /** Value model's P(win) for the acting side at decision time, when a
   *  winprob artifact is live (distillation target); null otherwise. */
  valueEstimate: number | null;
  /** 1 = actor won the game, 0 = lost, 0.5 = draw. Filled post-game. */
  outcome: number;
}

export interface SelfPlayGameRecord {
  gameIndex: number;
  seed: number;
  deckAId: string;
  deckBId: string;
  skillA: number;
  skillB: number;
  winner: "player" | "opponent" | null;
  endReason: string;
  turns: number;
  decisions: SelfPlayDecision[];
}

export interface SelfPlayOptions {
  /** Deck-list texts with stable ids (meta archetypes in production). */
  decks: { id: string; list: string }[];
  games: number;
  seed: number;
  /** Planner skill levels to cycle through (0..1). */
  skills?: number[];
  maxTurns?: number;
  /** Injected for tests; defaults to the live winprob artifact (or null). */
  evaluator?: StateEvaluator | null;
}

export const DEFAULT_SKILLS = [0.35, 0.65, 1];

/* ─── Recording policy ──────────────────────────────────────────── */

function valueSnapshot(view: PlayerView): Parameters<StateEvaluator>[0] {
  return {
    prize_diff: view.prizesTaken - view.opponent.prizesTaken,
    prizes_total: view.prizesTaken + view.opponent.prizesTaken,
    turn_number: view.turn.number,
    bench_diff: view.board.bench.length - view.opponent.board.bench.length,
    hand_diff: view.hand.length - view.opponent.handCount,
    went_first: view.wentFirst === null ? 0.5 : view.wentFirst ? 1 : 0,
    is_player_turn: 1, // chooseMove always runs on the acting side's turn
  };
}

class RecordingPolicy implements DecisionPolicy {
  constructor(
    private readonly inner: DecisionPolicy,
    private readonly actor: "player" | "opponent",
    private readonly skill: number,
    private readonly game: SelfPlayGameRecord,
    private readonly evaluator: StateEvaluator | null,
  ) {}

  chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove {
    const move = this.inner.chooseMove(view, legal, ctx);
    const candidates = legal.map((m) => ({
      kind: m.kind,
      features: encodeActionFeatures(view, m),
    }));
    const chosenJson = JSON.stringify(move);
    let chosenIndex = legal.findIndex((m) => JSON.stringify(m) === chosenJson);
    if (chosenIndex === -1) {
      // Planner decorated the move (e.g. auto-picked discard cost) — the
      // chosen action still gets a candidate row so the pair is complete.
      candidates.push({ kind: move.kind, features: encodeActionFeatures(view, move) });
      chosenIndex = candidates.length - 1;
    }
    this.game.decisions.push({
      actor: this.actor,
      turnNumber: view.turn.number,
      playerTurnNumber: view.turn.playerTurnNumber,
      decisionIndex: this.game.decisions.length,
      skill: this.skill,
      stateFeatures: encodeStateFeatures(view),
      candidates,
      chosenIndex,
      chosenKind: move.kind,
      valueEstimate: this.evaluator ? this.evaluator(valueSnapshot(view)) : null,
      outcome: 0.5,
    });
    return move;
  }

  choosePromotion(view: PlayerView): number {
    return this.inner.choosePromotion(view);
  }
}

/* ─── Generator ─────────────────────────────────────────────────── */

/** Deterministic per-game schedule: deck pairing, skills, and first actor
 *  all derive from (seed, gameIndex) alone. */
function schedule(opts: Required<Pick<SelfPlayOptions, "decks" | "skills">>, g: number) {
  const d = opts.decks.length;
  const s = opts.skills.length;
  const a = g % d;
  const b = d > 1 ? (a + 1 + (g % (d - 1))) % d : a;
  return {
    deckA: opts.decks[a],
    deckB: opts.decks[b],
    skillA: opts.skills[g % s],
    skillB: opts.skills[(g + 1) % s],
    firstActor: (g % 2 === 0 ? "player" : "opponent") as "player" | "opponent",
  };
}

export function generateSelfPlayGames(options: SelfPlayOptions): SelfPlayGameRecord[] {
  if (options.decks.length === 0) throw new Error("selfplay: no decks provided");
  const skills = options.skills?.length ? options.skills : DEFAULT_SKILLS;
  const evaluator =
    options.evaluator === undefined ? createBotEvaluator() : options.evaluator;
  const games: SelfPlayGameRecord[] = [];

  for (let g = 0; g < options.games; g++) {
    const plan = schedule({ decks: options.decks, skills }, g);
    const gameSeed = hashSeed(`selfplay:${options.seed}:${g}`);
    const record: SelfPlayGameRecord = {
      gameIndex: g,
      seed: gameSeed,
      deckAId: plan.deckA.id,
      deckBId: plan.deckB.id,
      skillA: plan.skillA,
      skillB: plan.skillB,
      winner: null,
      endReason: "turn_cap",
      turns: 0,
      decisions: [],
    };

    const mkPolicy = (side: "player" | "opponent", skill: number, seedSalt: number) =>
      new RecordingPolicy(
        new PlannerPolicy({
          params: plannerParamsForSkill(skill),
          seed: (gameSeed ^ seedSalt) >>> 0,
          ...(evaluator ? { evaluate: evaluator } : {}),
        }),
        side,
        skill,
        record,
        evaluator,
      );

    const outcome = playGame(
      instantiateDeck(plan.deckA.list),
      instantiateDeck(plan.deckB.list),
      {
        player: mkPolicy("player", plan.skillA, 0x9e3779b9),
        opponent: mkPolicy("opponent", plan.skillB, 0x85ebca6b),
      },
      mulberry32(gameSeed),
      plan.firstActor,
      options.maxTurns ? { maxTurns: options.maxTurns } : {},
    );

    record.winner = outcome.winner;
    record.endReason = outcome.endReason;
    record.turns = outcome.turns;
    for (const d of record.decisions) {
      d.outcome = outcome.winner === null ? 0.5 : outcome.winner === d.actor ? 1 : 0;
    }
    games.push(record);
  }

  return games;
}
