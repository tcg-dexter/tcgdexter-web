// A ROUTE planner: search over SEQUENCES of moves, not over a fixed template.
//
// WHY THE EXISTING PLANNER IS NOT THIS
//
// PlannerPolicy does search, and it is easy to mistake it for sequence
// planning. It is not. Its `enumerate` builds plans from a hand-designed
// four-slot template:
//
//     gust? x attach? x retreat? x attack?
//
// Everything else a turn contains — benching, evolving, activated abilities,
// Items, searches, Tools, Stadiums — is decided by a phased greedy priority
// list that returns BEFORE the search ever runs (see chooseMove's Phase 1/2).
// So the evaluator only ever arbitrates among plans of one predetermined
// SHAPE, and no amount of extra knowledge in it can produce a differently
// shaped turn.
//
// That is the measured ceiling, not a guess. Six interventions on the
// evaluator's inputs, labels, corpus size and search depth all landed inside
// the duel's noise floor; and on 4,698 real decisions two evaluators
// differing by 186 features chose the same move 99.4% of the time.
//
// WHAT THIS DOES INSTEAD
//
// Beam search over the actual legal move graph. At each step every legal move
// is applied to a cloned state — so each action's consequences are real, not
// estimated — and the resulting states are ranked and pruned to a beam. A
// route ends when it attacks or passes, or when it hits the depth cap.
//
// The search is over TURNS, not plies: a Pokémon TCG turn is many moves, and
// the thing a pilot gets wrong is the ORDER and COMBINATION of them (search
// before draw, bench before Poffin, evolve before attaching). Ply-deepening
// asks a different question and is left to PlannerPolicy's deepenTopK.
//
// COST. Branching is wide (14.6 legal moves at a median real decision), so an
// unbounded search is hopeless. The beam is the budget: BEAM x DEPTH x
// branching state-clones per turn, bounded and predictable, and the planner
// latency test is the gate that keeps it honest.

import { legalMoves, type SimMove, type TurnContext } from "./moves";
import type { GameState } from "../types";
import type { PlayerView } from "./view";
import { promoteBest, type DecisionPolicy } from "./policy";
import {
  applyPlanToGhost,
  buildGhostState,
  ghostView,
  heuristicEvaluator,
  type PlannerParams,
  type StateEvaluator,
} from "./planner";
import { PlannerPolicy } from "./planner";
import { mulberry32 } from "./rng";

export interface RoutePlannerOptions {
  params: PlannerParams;
  seed?: number;
  evaluate?: StateEvaluator;
  /** Sequences kept at each depth. Wider = better routes, linear cost. */
  beam?: number;
  /** Maximum moves in a route. A real turn rarely exceeds this. */
  maxDepth?: number;
  /** Let the SEARCH decide the moves the development prior normally makes.
   *
   *  Measured on 5,180 real decisions with >=2 legal moves: the prior decides
   *  **89.2%** of them and the search only ever sees the remaining 10.8%.
   *  That is the real ceiling — it is why a better evaluator changes 3.3% of
   *  moves, 186 extra features change 0.6%, and swapping the template for a
   *  beam search changes 2.2%. Every model intervention has been arbitrating
   *  a tenth of the game.
   *
   *  Turning this on without `developmentWeight` reproduces the known
   *  failure: the leaf objective does not value setup, so the search plays
   *  one card and passes (40.1% in a true mirror). The two options are meant
   *  to be used together — the point is to convert a hardcoded prior into a
   *  SCORED quantity the search can trade off against tempo and damage. */
  claimDevelopment?: boolean;
  /** Weight on the development term. 0 disables it. */
  developmentWeight?: number;
}

/** Defaults chosen against the interactive latency budget, not taste.
 *  BEAM 6 x DEPTH 10 is ~3x PlannerPolicy's template enumeration on the
 *  benchmark and stays inside the budget the planner latency test enforces. */
const DEFAULT_BEAM = 6;
const DEFAULT_MAX_DEPTH = 10;
/** Points per unit of board development. Calibrated against the leaf
 *  scorer's existing tactical terms (prizeConversion is the largest at
 *  roughly a prize's worth), so development is worth real but not
 *  prize-dominating value: a bench slot should never outrank taking a KO. */
const DEFAULT_DEVELOPMENT_WEIGHT = 0.12;

interface Route {
  moves: SimMove[];
  state: GameState;
  score: number;
  /** True once the route has attacked or passed — a finished turn. */
  done: boolean;
}

/** A move's identity for de-duplication. Two routes that reach the same
 *  position by different orderings are the same route for our purposes, and
 *  keeping both wastes beam width on a distinction with no consequence. */
function routeKey(state: GameState): string {
  const s = state.sides.player;
  const mon = (m: { card: { name: string }; damage: number; attachedEnergy: unknown[] } | null) =>
    m ? `${m.card.name}:${m.damage}:${m.attachedEnergy.length}` : "-";
  return [
    mon(s.active),
    s.bench.map(mon).sort().join(","),
    s.hand.length,
    s.discard.length,
    state.prizesTaken.player,
    state.prizesTaken.opponent,
    state.sides.opponent.active?.damage ?? -1,
  ].join("|");
}

export class RoutePlannerPolicy implements DecisionPolicy {
  private readonly params: PlannerParams;
  private readonly seed: number;
  private readonly evaluate: StateEvaluator;
  private readonly beam: number;
  private readonly maxDepth: number;
  private readonly claimDevelopment: boolean;
  private readonly developmentWeight: number;
  /** Leaf scoring is DELEGATED to a template planner instance, deliberately.
   *
   *  A first cut scored routes with the evaluator plus a prize bonus and lost
   *  a true mirror at 41.5% — but that experiment changed the SEARCH and the
   *  SCORING at once, so it could not say which was responsible. The template
   *  planner's leaf score carries tactical terms (KO threat both ways, damage
   *  progress, attack investment, tempo) that are worth real points on their
   *  own; dropping them silently handicaps the search under test. Sharing the
   *  scorer isolates the one variable this class exists to change. */
  private readonly scorer: PlannerPolicy;
  private queue: SimMove[] = [];
  private plannedTurn = -1;

  constructor(options: RoutePlannerOptions) {
    this.params = options.params;
    this.seed = options.seed ?? 1;
    this.evaluate = options.evaluate ?? heuristicEvaluator;
    this.beam = options.beam ?? DEFAULT_BEAM;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.claimDevelopment = options.claimDevelopment ?? false;
    this.developmentWeight = options.developmentWeight ?? DEFAULT_DEVELOPMENT_WEIGHT;
    this.scorer = new PlannerPolicy({
      params: this.params,
      seed: this.seed,
      ...(options.evaluate ? { evaluate: options.evaluate } : {}),
    });
  }

  chooseMove(view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    // One route per turn. Replanning after every move would discard the
    // sequence the search just proved was good, which is the whole point of
    // planning a route rather than a move.
    if (view.turn.number !== this.plannedTurn) {
      this.queue = [];
      this.plannedTurn = view.turn.number;
    }
    // FREE DEVELOPMENT first, from the template planner's own prior.
    //
    // Not a shortcut — a correction. The leaf objective does not value setup:
    // benching and evolving move neither prizes nor damage and shrink the
    // hand, so a free-form search over the whole move graph finds that playing
    // one card and passing is "optimal". Measured: a route planner without
    // this prior plans `play_trainer -> pass` where the template planner plays
    // a 13-move turn, and loses a true mirror at 40.1%. The knowledge lives in
    // the hand-written phases, so the honest experiment is to keep it and
    // search the CONSEQUENTIAL remainder — which is the part a template
    // constrains to gust x attach x retreat x attack.
    if (!this.claimDevelopment) {
      const dev = this.scorer.developmentMove(view, legal);
      if (dev) return dev;
    }

    if (this.queue.length === 0) this.queue = this.planRoute(view, legal);

    // The queue can go stale: an effect may resolve differently than the
    // ghost predicted (a search that whiffs, a coin flip). Drop stale moves
    // rather than forcing them — an illegal move would be rejected by the
    // validator and the turn would stall.
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (isLegal(next, legal)) return next;
    }
    return legal.find((m) => m.kind === "pass") ?? legal[0];
  }

  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }

  /** Beam search over move sequences. Returns the best route as a move list. */
  private planRoute(view: PlayerView, legal: SimMove[]): SimMove[] {
    // Stock the ghost deck with named cards when the search owns development:
    // it then has to play search-Items, and those cannot resolve against a
    // deck of anonymous placeholders (139 of 157 play_trainer moves failed).
    const ghost = buildGhostState(view, { stockDeck: this.claimDevelopment });
    const rng = mulberry32((this.seed ^ Math.imul(view.turn.number + 1, 0x9e3779b9)) >>> 0);

    let beam: Route[] = [
      { moves: [], state: ghost, score: this.score(ghost, view), done: false },
    ];
    const finished: Route[] = [];

    for (let depth = 0; depth < this.maxDepth; depth++) {
      const next: Route[] = [];
      const seen = new Set<string>();
      for (const route of beam) {
        if (route.done) {
          finished.push(route);
          continue;
        }
        let moves: SimMove[];
        try {
          moves = legalMoves(route.state, "player", { retreated: false });
        } catch {
          finished.push(route);
          continue;
        }
        for (const move of moves) {
          // Applying the move IS the consequence model — no estimate of what
          // a card does, the engine resolves it.
          const after = applyPlanToGhost(route.state, [move]);
          if (!after) continue;
          const done = move.kind === "attack" || move.kind === "pass" || after.winner !== null;
          const key = `${done ? "T" : "F"}|${routeKey(after)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({
            moves: [...route.moves, move],
            state: after,
            // Rank by the value of the turn IF IT ENDED HERE, not by the
            // value of a half-played turn.
            //
            // This is the difference between a beam search that works and one
            // that does not. A partial turn always scores worse than a turn
            // that has already attacked — cards have left hand, no damage is
            // on the board yet — so ranking partial states directly prunes
            // every development line before it reaches its payoff, and the
            // search collapses onto "attack immediately". Measured: 40.7% in
            // a true mirror against the template planner. Completing each
            // route makes all beam entries comparable as finished turns,
            // which is the only comparison the leaf scorer is valid for.
            score: done ? this.score(after, view) : this.completedScore(after, view),
            done,
          });
        }
      }
      if (next.length === 0) break;
      next.sort((a, b) => b.score - a.score);
      // Finished routes leave the beam so they cannot crowd out lines that
      // still have moves to make; they compete again at the end.
      for (const r of next.filter((r) => r.done)) finished.push(r);
      beam = next.filter((r) => !r.done).slice(0, this.beam);
      if (beam.length === 0) break;
    }
    for (const r of beam) finished.push(r);
    if (finished.length === 0) return [{ kind: "pass" }];

    finished.sort((a, b) => b.score - a.score);
    // Same exploration model as PlannerPolicy so the difficulty dial keeps
    // meaning the same thing across both pilots.
    if (rng() < this.params.epsilon) {
      return finished[Math.floor(rng() * finished.length)].moves;
    }
    const tau = Math.max(0.01, this.params.temperature);
    const max = finished[0].score;
    const weights = finished.map((r) => Math.exp((r.score - max) / tau));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = rng() * total;
    for (let i = 0; i < finished.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return finished[i].moves;
    }
    return finished[0].moves;
  }

  /** Value of stopping here: pass to end the turn, then score the settled
   *  state. Falls back to the raw score if passing is somehow illegal. */
  private completedScore(state: GameState, from: PlayerView): number {
    const ended = applyPlanToGhost(state, [{ kind: "pass" }]);
    return ended ? this.score(ended, from) : this.score(state, from);
  }

  /** Score a settled state from the acting side's view — the template
   *  planner's own leaf scorer, so search shape is the only difference,
   *  PLUS an explicit development term when the search has to decide
   *  development for itself. */
  private score(state: GameState, from: PlayerView): number {
    const base = this.scorer.scoreLeaf(state, from);
    if (!this.claimDevelopment || this.developmentWeight === 0) return base;
    return base + this.developmentWeight * developmentValue(state);
  }
}

/** What the hardcoded development prior is implicitly worth, as a number.
 *
 *  The prior encodes real knowledge the leaf objective lacks: benching and
 *  evolving move neither prizes nor damage and shrink your hand, so they
 *  score neutral-to-negative on a scorer built around prize race and damage.
 *  Every term here is public board state, deliberately — a development term
 *  that peeked at hand contents would reward drawing rather than developing.
 *
 *  Bench is capped at 5 (the legal maximum) so the search cannot farm value
 *  from a quantity the rules bound anyway. */
export function developmentValue(state: GameState): number {
  const side = state.sides.player;
  const mons = [side.active, ...side.bench].filter((m) => m != null);
  let stages = 0;
  let energy = 0;
  let tools = 0;
  for (const mon of mons) {
    // Stack depth IS evolution progress: a Stage 2 carries two cards under it.
    stages += mon!.stack.length;
    energy += mon!.attachedEnergy.length;
    tools += mon!.attachedTools.length;
  }
  const bench = Math.min(side.bench.length, 5);
  return bench + stages + 0.5 * energy + 0.5 * tools;
}

function isLegal(move: SimMove, legal: SimMove[]): boolean {
  return legal.some((m) => JSON.stringify(m) === JSON.stringify(move));
}
