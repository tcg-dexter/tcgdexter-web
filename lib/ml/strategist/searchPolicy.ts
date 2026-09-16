// Play the move with the highest rolled-out value. No priority list.
//
// This is the fourth attempt to own the 89.2% of decisions that
// PlannerPolicy's hardcoded development prior currently makes before any
// search runs. The previous three were measurably worse than that priority
// list:
//
//   route beam search (prior kept)      47.82%  CI [45.8, 49.8]
//   development bonus (search claims)   42.77%  CI [40.8, 44.8]
//   learned ranker (100% of decisions)  43.23%  CI [41.2, 45.3]
//
// Why this one is different in kind, rather than just different:
//
//   * The earlier searches all scored a SETTLED state with a static
//     evaluator, so a development move had to look good immediately. It never
//     does — benching and evolving move neither prizes nor damage, which is
//     precisely why the priority list exists. Here the rollout keeps playing,
//     so a benched Pokémon's value shows up as the attack it makes two turns
//     later. Nothing has to express development; it just happens.
//   * The learned ranker was trained to imitate the planner, so it inherited
//     the planner's ceiling and then lost points to its own 50% top-1 noise.
//     A rollout has no teacher.
//   * The opponent is determinized from the meta prior rather than left as
//     placeholder cards, so candidate moves are priced against an opponent
//     that can actually answer them.
//
// It is far too slow for the live interactive bot (~0.1-0.8 s per decision
// against the planner's ~1 ms) and is not proposed as one. It is a reference
// player: the thing the fast models get distilled from, and the thing that
// says whether regret is measuring real quality.

import {
  HeuristicPolicy,
  buildGhostState,
  hashSeed,
  promoteBest,
  type DecisionPolicy,
  type PlayerView,
  type SimMove,
  type StateEvaluator,
  type TurnContext,
} from "@/lib/engine/sim";

import { encodeActionFeatures, encodeStateFeatures } from "@/lib/ml/features/policy";
import { scoreCandidates, type PolicyRankerArtifact } from "@/lib/ml/policyModel";

import { determinizeOpponent, determinizeRng } from "./determinize";
import { analyzeDecision, moveKey, semanticMoveKey, type DecisionAnalysis } from "./regret";

export interface SearchPolicyOptions {
  rollouts?: number;
  horizon?: number | null;
  evaluate?: StateEvaluator | null;
  seed?: number;
  /** Determinize the opponent's hidden zones from the meta prior. */
  determinize?: boolean;
  /** Skip the search above this many legal moves and defer to the fallback.
   *  Cost is linear in candidates and the tail is long. */
  maxCandidates?: number;
  /** Consulted when the search is skipped or its answer cannot be mapped
   *  back to a real legal move. */
  fallback?: DecisionPolicy;
  /** A learned policy used as a SEARCH PRIOR: candidates are ranked by it and
   *  only the top `priorTopK` are rolled out.
   *
   *  This is the second half of Expert Iteration. Round one distils the
   *  search into an apprentice; round two hands the apprentice back to the
   *  expert so it stops spending rollouts on moves that were never going to
   *  win. It buys two things at once — cost falls roughly with the pruning
   *  ratio, and `maxCandidates` can be RAISED, so the ~15% of decisions
   *  currently skipped as too wide become searchable instead of falling
   *  through to the heuristic. */
  prior?: PolicyRankerArtifact | null;
  /** Candidates to keep when a prior is supplied. */
  priorTopK?: number;
  /** Called with every analysis the search performs, for corpus capture.
   *  Distillation is free here: the search has to value every legal move in
   *  order to pick one, so the training labels are a by-product of play
   *  rather than a second pass. */
  onAnalysis?: (view: PlayerView, ctx: TurnContext, analysis: DecisionAnalysis) => void;
  /** Rebuild our OWN deck in the ghost from `view.unseenOwn` (legitimate
   *  self-knowledge: the multiset of cards not yet seen). PlannerPolicy does
   *  NOT do this — planner.ts explains why it is harmless there, since its
   *  development prior plays every search-Item before the search runs. It is
   *  NOT harmless here, so this flag exists to measure how much of the
   *  strength is the stocked deck rather than the search. */
  stockDeck?: boolean;
}

export interface SearchPolicyStats {
  decisions: number;
  searched: number;
  /** Decisions with only one legal move — no choice to make. */
  trivial: number;
  /** Skipped by `maxCandidates`. */
  tooWide: number;
  /** Search ran but its move did not map back to the real legal set even by
   *  name. A non-zero count is a ghost-fidelity defect, not a tuning knob. */
  unmapped: number;
  /** Mapped back by NAME rather than by id — a deck search, where the ghost's
   *  rebuilt deck necessarily uses synthetic card ids. */
  byName: number;
  /** Candidates dropped by the search prior before any rollout. */
  pruned: number;
  /** Mean seconds per searched decision. */
  secondsPerSearch: number;
}

export class SearchPolicy implements DecisionPolicy {
  private readonly opts: Required<
    Pick<
      SearchPolicyOptions,
      "rollouts" | "horizon" | "determinize" | "maxCandidates" | "seed" | "stockDeck"
    >
  > & { evaluate: StateEvaluator | null; fallback: DecisionPolicy };

  readonly stats: SearchPolicyStats = {
    decisions: 0,
    searched: 0,
    trivial: 0,
    tooWide: 0,
    unmapped: 0,
    byName: 0,
    pruned: 0,
    secondsPerSearch: 0,
  };

  private elapsedMs = 0;
  private counter = 0;
  private readonly prior: PolicyRankerArtifact | null;
  private readonly priorTopK: number;
  private readonly onAnalysis?: (
    view: PlayerView,
    ctx: TurnContext,
    analysis: DecisionAnalysis,
  ) => void;

  constructor(options: SearchPolicyOptions = {}) {
    this.opts = {
      rollouts: options.rollouts ?? 8,
      horizon: options.horizon === undefined ? 6 : options.horizon,
      determinize: options.determinize ?? true,
      maxCandidates: options.maxCandidates ?? 24,
      stockDeck: options.stockDeck ?? true,
      seed: options.seed ?? 1,
      evaluate: options.evaluate ?? null,
      fallback: options.fallback ?? new HeuristicPolicy(),
    };
    this.onAnalysis = options.onAnalysis;
    this.prior = options.prior ?? null;
    this.priorTopK = options.priorTopK ?? 6;
    if (this.opts.horizon !== null && !this.opts.evaluate) {
      throw new Error("SearchPolicy: a finite horizon needs an evaluator");
    }
  }

  chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove {
    this.stats.decisions += 1;
    if (legal.length === 1) {
      this.stats.trivial += 1;
      return legal[0];
    }
    if (this.opts.maxCandidates > 0 && legal.length > this.opts.maxCandidates) {
      this.stats.tooWide += 1;
      return this.opts.fallback.chooseMove(view, legal, ctx);
    }

    // Search prior: keep the apprentice's top-K, and ALWAYS keep `pass` so the
    // search can still decline to act. Dropping it would make ending the turn
    // unreachable whenever the apprentice ranks it low, which is a behaviour
    // change disguised as an optimisation.
    //
    // The pool ALSO acts as a mappability filter, and that part applies with
    // or without a prior: restricting the ghost's candidates to moves that
    // correspond to something in the real legal set means the search can only
    // ever return something applicable. Without it, ~7% of searched decisions
    // picked a ghost move with no real counterpart and fell through to the
    // heuristic — strictly worse than picking the best MAPPABLE move.
    let pool = legal;
    if (this.prior && legal.length > this.priorTopK) {
      try {
        const stateVec = encodeStateFeatures(view);
        const { scores } = scoreCandidates(
          this.prior,
          stateVec,
          legal.map((m) => encodeActionFeatures(view, m)),
        );
        const order = legal.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
        const keep = new Set(order.slice(0, this.priorTopK));
        const passIdx = legal.findIndex((m) => m.kind === "pass");
        if (passIdx >= 0) keep.add(passIdx);
        pool = legal.filter((_, i) => keep.has(i));
        this.stats.pruned += legal.length - pool.length;
      } catch {
        // A prior that cannot score is a prior we do not use. Falling back to
        // the full candidate set is slower, never wrong.
        pool = legal;
      }
    }

    // The ghost is the honest information set: our own hand and deck are
    // real (stockDeck), every opponent hidden zone is placeholders until
    // determinize fills it from public evidence only.
    const ghost = buildGhostState(view, { stockDeck: this.opts.stockDeck });
    const decisionSeed = hashSeed(`${this.opts.seed}:${this.counter++}`);

    const t0 = Date.now();
    // Match the kept pool on BOTH keys. A ghost's deck-search move carries
    // synthetic card ids, so an exact-key filter silently drops every one of
    // them — which looked like an improvement (unmapped fell to 0) because it
    // had made the whole class of moves unreachable rather than fixing it.
    const poolExact = new Set(pool.map((m) => moveKey(m)));
    const poolSemantic = new Set(pool.map((m) => semanticMoveKey(m)));
    const analysis = analyzeDecision(ghost, "player", ctx, null, {
      candidateFilter: (m) => poolExact.has(moveKey(m)) || poolSemantic.has(semanticMoveKey(m)),
      rollouts: this.opts.rollouts,
      horizon: this.opts.horizon,
      evaluate: this.opts.evaluate,
      seed: decisionSeed,
      prepare: this.opts.determinize
        ? (clone, r) => {
            determinizeOpponent(clone, view, determinizeRng(decisionSeed, r));
          }
        : undefined,
    });
    this.elapsedMs += Date.now() - t0;

    if (!analysis) return this.opts.fallback.chooseMove(view, legal, ctx);
    this.stats.searched += 1;
    if (this.onAnalysis) this.onAnalysis(view, ctx, analysis);
    this.stats.secondsPerSearch = this.elapsedMs / 1000 / Math.max(1, this.stats.searched);

    // Map back to the caller's own move objects. Hand and board cards keep
    // their real ids in the ghost so an exact structural key matches; a deck
    // SEARCH cannot, because the ghost's deck is rebuilt from `unseenOwn`
    // with synthetic ids. Those fall through to the name-based key.
    const best = analysis.candidates[analysis.bestIndex].move;
    const want = moveKey(best);
    let hit = legal.find((m) => moveKey(m) === want);
    if (!hit) {
      const semantic = semanticMoveKey(best);
      hit = legal.find((m) => semanticMoveKey(m) === semantic);
      if (hit) this.stats.byName += 1;
    }
    if (!hit) {
      this.stats.unmapped += 1;
      return this.opts.fallback.chooseMove(view, legal, ctx);
    }
    return hit;
  }

  choosePromotion(view: PlayerView): number {
    // Promotion is a one-off forced choice with its own cheap heuristic; the
    // rollout machinery would cost more than the decision is worth.
    return promoteBest(view.board.bench);
  }
}
