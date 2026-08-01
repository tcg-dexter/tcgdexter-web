// PlannerPolicy — the AI player's brain (chess.com model: one engine,
// difficulty as selection fidelity).
//
// Per turn it plays in three phases:
//   1. Free development (bench all basics, evolve everything eligible) —
//      always right under v1 rules, so not part of the search.
//   2. Information gathering: cycle trainers for draws (deck-out guarded).
//      Each cycle reveals cards, so the planner re-enters with the fresh
//      hand before committing to anything consequential.
//   3. The searched decision: enumerate candidate (attach × retreat ×
//      attack) plans on a GHOST STATE built strictly from the PlayerView
//      (hidden zones are placeholders — the planner physically cannot use
//      information a human wouldn't have), score each end state with an
//      injected StateEvaluator (the winprob model in production, a
//      heuristic fallback otherwise) plus tactical terms, then select via
//      softmax(temperature) + ε-random. Low temperature ⇒ near-optimal
//      ordering; high ⇒ plausible-but-sloppy play. Seeded ⇒ deterministic.

import type { CardInstance, GameState, PokemonInPlay } from "../types";
import { ENGINE_VERSION } from "../types";
import { applyMove, otherActor, promote } from "./driver";
import {
  baseDamage,
  computeDamage,
  costProgress,
  legalMoves,
  remainingHp,
  usableAttacks,
  type SimMove,
  type TurnContext,
} from "./moves";
import {
  HeuristicPolicy,
  bestSearchTrainer,
  chooseAbilityMove,
  chooseBenchMove,
  chooseEffectMove,
  promoteBest,
  wantsDrawRefresh,
  type DecisionPolicy,
  wantsSearch,
  energyAccelMoves,
  chooseRepositionEffect,
} from "./policy";
import { energyProvides, energyUnits, prizeValue } from "./setup";
import { isSupporter, trainerSpec, type PlayTrainerMove, type TrainerSpec } from "./trainers";
import { effectMovePhase } from "./effects/cards";
import { estimatedAttackDamage } from "./attacks";
import type { EffectMove } from "./effects/runtime";
import { canRetreat } from "./tools";
import { lookupCard } from "../catalog";
import { makeUnrevealed } from "../initial";
import { mulberry32 } from "./rng";
import { viewFor, type PlayerView } from "./view";

/* ─── Evaluator contract ────────────────────────────────────────── */

/** Post-plan snapshot from the ACTING side's perspective. Field names
 *  deliberately mirror lib/ml/winprob.ts's turnFeatureVector so the
 *  trained artifact can score it directly (lib/ml/botEvaluator.ts). */
export interface PlanSnapshot {
  prize_diff: number;
  prizes_total: number;
  turn_number: number;
  bench_diff: number;
  hand_diff: number;
  went_first: number;
  is_player_turn: number;
}

/** Returns roughly P(win) in (0, 1) for the acting side.
 *
 *  `view` is the acting side's PlayerView of the evaluated end state — the
 *  same redacted information set a real player would have. It carries the
 *  board detail (HP, damage, energy, readiness, conditions) that
 *  PlanSnapshot's handful of scalars cannot, which is what a board-aware
 *  evaluator needs; snapshot-only evaluators simply ignore it. The sim
 *  hands over a sim-native type, so lib/engine/sim stays ML-free. */
export type StateEvaluator = (snapshot: PlanSnapshot, view?: PlayerView) => number;

/** Fallback when no trained artifact is live: prize lead dominates, board
 *  and hand size break ties. Clamped away from certainty. */
export const heuristicEvaluator: StateEvaluator = (s) => {
  const raw = 0.5 + 0.07 * s.prize_diff + 0.015 * s.bench_diff + 0.008 * s.hand_diff;
  return Math.min(0.98, Math.max(0.02, raw));
};

/* ─── Planner ───────────────────────────────────────────────────── */

export interface PlannerParams {
  /** Softmax temperature over plan scores. Low ⇒ picks the best plan. */
  temperature: number;
  /** Probability of ignoring scores entirely for a uniform-random plan. */
  epsilon: number;
  /** Cap on enumerated candidate plans per turn. */
  maxCandidates: number;
}

/** Hand-tuned score adjustments layered on top of the evaluator. Several of
 *  these exist only because the original 8-scalar evaluator was blind to the
 *  board (damage, energy, readiness); a board-aware evaluator prices those
 *  itself, so keeping both double-counts. Injectable so they can be A/B'd
 *  against the mirror benchmark instead of guessed at. */
export interface TacticalWeights {
  damageProgress: number;
  koThreat: number;
  activeReady: number;
  attackInvestment: number;
  prizeConversion: number;
  noAttackTempo: number;
  retreatTempo: number;
  attachTiebreak: number;
}

/**
 * Chooses the opponent's reply among public-information options (attacks by
 * their active; retreats to a battle-ready bench mon). Injected the same way
 * as StateEvaluator so lib/engine stays ML-free — lib/ml supplies a learned
 * chooser (the policy ranker). Return null to decline; the planner then
 * falls back to its hardest-hit rule. The view passed is the OPPONENT'S
 * information set of the ghost state (their hand is unrevealed placeholders).
 */
export type ReplyChooser = (view: PlayerView, options: SimMove[]) => SimMove | null;

export interface PlannerOptions {
  params: PlannerParams;
  seed: number;
  evaluate?: StateEvaluator;
  /** Overrides merged over DEFAULT_TACTICAL_WEIGHTS. */
  tactical?: Partial<TacticalWeights>;
  /** How many of the best 1-ply candidates get re-scored at 3 ply (see
   *  deepen()). 0 disables deepening. Defaults to DEFAULT_DEEPEN_TOP_K. */
  deepenTopK?: number;
  /** Learned opponent-reply model; omitted = the built-in hardest-hit rule. */
  replyChooser?: ReplyChooser;
}

/** Keep enough deck to survive several more turn-start draws. Real search
 *  effects (Milestone D) thin the deck much faster than generic cycling
 *  did, so the reserve is the main deck-out guard — losing to deck-out
 *  while ahead on prizes is the classic self-inflicted defeat. */
const CYCLE_DECK_RESERVE = 8;
const RETREAT_TEMPO_PENALTY = 0.05;
const ACTIVE_READY_BONUS = 0.03;
// The win-prob evaluator only sees prizes/board counts, so mid-KO progress
// must be scored tactically: full progress toward a KO ≈ a meaningful
// fraction of a prize swing, an immediate KO threat slightly more, and
// attached energy has retention value (makes retreat costs non-free).
const DAMAGE_PROGRESS_WEIGHT = 0.08;
const KO_THREAT_BONUS = 0.08;
// One-ply search can't see that energy banked on a 3-cost attacker pays
// off in two turns — without an investment value the bot scatters energy
// onto whatever cheap attack lights up THIS turn and retreats it away.
// Value = progress toward each mon's best attack, scaled by its ceiling.
const ATTACK_INVESTMENT_WEIGHT = 0.1;
// Prizes actually banked by the plan must outrank any damage-progress
// farming: the sigmoid evaluator saturates in winning positions (a KO's
// prize shows up as +0.004 while keeping the damaged target alive keeps a
// +0.06 progress bonus) — without this term the argmax bot learns to
// stall instead of converting knockouts.
const PRIZE_CONVERSION_BONUS = 0.15;
// One-ply exchange pricing makes "do nothing" look free: against a
// harmless active, pass scores as the zero-risk line (the reply term only
// punishes attacking into a counter-KO), so standoffs stall for dozens of
// turns and self-play games decayed into deck-out. Every plan that ends
// the turn without attacking pays this flat tempo cost — when no attack
// line exists all candidates pay it equally and the ordering is untouched,
// so it only ever tips choices toward attacking.
//   A/B-swept (see git history): the value trades off two things — a bigger
// penalty shifts more decisions toward attacking, but too large a value
// compresses the skill ladder (easy/medium/hard differ only in exploration
// noise over the same greedy scores, so over-shaping the greedy policy
// erodes their separation and breaks the difficulty-ladder tests). 0.04 is
// the largest value that keeps the ladder intact with margin (medium beats
// easy ~0.65) while cutting self-play deck-out ~46.7% → ~41.7% and raising
// the attack share; ≥0.08 breaks the ladder for no extra deck-out gain.
const NO_ATTACK_TEMPO_PENALTY = 0.04;
// An energy that advances no attack scores identically to not attaching
// (the investment term sees no progress), and the softmax splits exact
// ties — so ~half of those turns silently wasted the attachment. Banked
// energy is retreat fuel at worst; a hair of value breaks the tie.
const ATTACH_TIEBREAK_BONUS = 0.01;

// Selective deepening budget (see deepen()). Re-scoring every candidate at
// 3 ply would blow the interactive latency budget, so only the best few
// 1-ply lines are deepened and each follow-up turn is bounded.
//
// DEFAULT IS OFF — measured, not assumed. On the frozen benchmark with the
// value-v0 evaluator (12 decks, both seat directions, n=1440 per cell):
//     vs HeuristicPolicy   1-ply 55.1% (CI 52.6-57.7)
//                          3-ply 53.4% (CI 50.8-55.9)
//     head-to-head         3-ply beats 1-ply 52.8% (CI 50.2-55.4)
// The two measurements disagree in SIGN and their intervals overlap, so
// there is no robust gain — while planning cost roughly doubles. Two real
// bugs were fixed along the way (leaf ply-parity, and the follow-up turn
// inheriting the current turn's spent allowances), each of which moved the
// head-to-head several points, so the machinery itself is sound.
//
// The likely blocker is evaluation quality, not depth: deeper search
// extrapolates a linear value model into hypothetical futures where it is
// less reliable, and taking a max over noisy leaf estimates biases the
// result upward (winner's curse). Revisit when the evaluator improves —
// that is the same lesson the blind-evaluator work landed on.
const DEFAULT_DEEPEN_TOP_K = 0;
const FOLLOWUP_CANDIDATE_CAP = 12;

/** The shipped values above, as an overridable bundle (see TacticalWeights). */
export const DEFAULT_TACTICAL_WEIGHTS: TacticalWeights = {
  damageProgress: DAMAGE_PROGRESS_WEIGHT,
  koThreat: KO_THREAT_BONUS,
  activeReady: ACTIVE_READY_BONUS,
  attackInvestment: ATTACK_INVESTMENT_WEIGHT,
  prizeConversion: PRIZE_CONVERSION_BONUS,
  noAttackTempo: NO_ATTACK_TEMPO_PENALTY,
  retreatTempo: RETREAT_TEMPO_PENALTY,
  attachTiebreak: ATTACH_TIEBREAK_BONUS,
};

interface CandidatePlan {
  moves: SimMove[];
  score: number;
  /** Tempo shaping already folded into `score`. Kept so a deeper re-score of
   *  the same plan can re-apply it — tempo is a property of the plan (did it
   *  attack? did it retreat?), not of the search horizon. */
  tempo: number;
}

/* ── Evaluator-discrimination probe ──────────────────────────────
 * Diagnostic only, and OFF unless startPlannerProbe() is called. The
 * question it answers: within a single turn, does the learned evaluator
 * actually separate sibling candidate plans, or do the hand-tuned tactical
 * terms do all the ordering? A near-flat evaluator was the blind snapshot
 * model's fatal flaw; this measures whether the board-aware model still has
 * a milder version of it. Inactive cost is one null check per candidate. */
export interface ProbeCandidate {
  /** The learned evaluator's raw output for this plan's leaf. */
  evalPart: number;
  /** Everything leafScore adds on top: prize/damage/KO/ready/investment. */
  tacticalPart: number;
  /** Final comparable score (leaf minus tempo) — what softmax ranks. */
  total: number;
}

let PROBE: ProbeCandidate[][] | null = null;

/** When probing with a learned ReplyChooser armed: how often its pick
 *  matches what the built-in hardest-hit rule would have chosen for the
 *  same options. Near-1 agreement means a reply-model swap has no lever. */
export const REPLY_AGREEMENT = { total: 0, agree: 0 };

/** Begin collecting per-turn candidate breakdowns. */
export function startPlannerProbe(): void {
  PROBE = [];
  REPLY_AGREEMENT.total = 0;
  REPLY_AGREEMENT.agree = 0;
}

/** Stop collecting and return one entry per planned turn. */
export function collectPlannerProbe(): ProbeCandidate[][] {
  const out = PROBE ?? [];
  PROBE = null;
  return out;
}

export class PlannerPolicy implements DecisionPolicy {
  private readonly params: PlannerParams;
  private readonly evaluate: StateEvaluator;
  private readonly seed: number;
  private readonly tactical: TacticalWeights;
  private readonly deepenTopK: number;
  private readonly replyChooser: ReplyChooser | null;
  private queue: SimMove[] = [];
  private plannedTurn = -1;
  /** Last leaf's raw evaluator output, for the probe. NaN when the leaf was a
   *  terminal win/loss shortcut that never consulted the evaluator. */
  private probeEval = Number.NaN;

  constructor(options: PlannerOptions) {
    this.params = options.params;
    this.evaluate = options.evaluate ?? heuristicEvaluator;
    this.seed = options.seed >>> 0;
    this.tactical = { ...DEFAULT_TACTICAL_WEIGHTS, ...options.tactical };
    this.deepenTopK = options.deepenTopK ?? DEFAULT_DEEPEN_TOP_K;
    this.replyChooser = options.replyChooser ?? null;
  }

  chooseMove(view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    if (view.turn.number !== this.plannedTurn) {
      this.queue = [];
      this.plannedTurn = view.turn.number;
    }

    const specOf = (m: SimMove): TrainerSpec | null => {
      if (m.kind !== "play_trainer") return null;
      const card = view.hand.find((c) => c.id === m.cardId);
      return card ? trainerSpec(card) : null;
    };

    // Phase 1 — free development (never part of the search). Rare Candy
    // is a strictly-better evolve, so it rides along here (active first).
    // Shared with HeuristicPolicy so bench selection can't drift between the
    // two pilots — this was `legal.find(...)`, i.e. hand order.
    const sloppy = this.sloppyDevelopment(view);
    const bench = sloppy
      ? legal.find((m) => m.kind === "bench")
      : chooseBenchMove(view, legal);
    if (bench) return bench;
    const candies = legal.filter(
      (m): m is PlayTrainerMove =>
        m.kind === "play_trainer" && specOf(m)?.effect.kind === "rare_candy",
    );
    if (candies.length > 0) {
      return candies.find((m) => m.monId === view.board.active?.id) ?? candies[0];
    }
    const evolves = legal.filter((m) => m.kind === "evolve");
    if (evolves.length > 0) {
      const activeEvolve = evolves.find(
        (m) => m.kind === "evolve" && m.targetId === view.board.active?.id,
      );
      return activeEvolve ?? evolves[0];
    }

    // Activated abilities (Munkidori, Dusknoir) — beneficial, don't end turn.
    const ability = chooseAbilityMove(view, legal);
    if (ability) return ability;

    // Put a Stadium into play (free development).
    const stadium = legal.find((m) => m.kind === "play_stadium");
    if (stadium) return stadium;

    // Attach a Tool (active preferred).
    const tools = legal.filter((m) => m.kind === "attach_tool");
    if (tools.length > 0) {
      return (
        tools.find((m) => m.kind === "attach_tool" && m.targetId === view.board.active?.id) ??
        tools[0]
      );
    }

    // Use an activated Stadium effect (Artazon).
    const stadiumEffect = legal.find((m) => m.kind === "use_stadium");
    if (stadiumEffect) return stadiumEffect;

    // Energy ACCELERATION is free development too — and it must happen before
    // the plan search, which ends the turn on an attack. Shared with
    // HeuristicPolicy; see energyAccelMoves for why the old placement (dead
    // last, as a `tactical` effect) meant it essentially never fired.
    if (!sloppy) {
      const reposition = chooseRepositionEffect(view, legal);
      if (reposition) return reposition;
      const accel = energyAccelMoves(view, legal);
      if (accel.length > 0) return accel[0];
    }

    // Phase 2 — reveal information before deciding (each play reveals
    // cards; the consequential plan is recomputed on the post-draw hand).
    // Draw supporters go first (a refreshed hand feeds the searches), and
    // are held back when a tactical supporter (Boss) is in hand — the
    // supporter slot is worth more in the plan search.
    const tacticalSupporterInHand = view.hand.some((c) => {
      const spec = trainerSpec(c);
      return spec?.phase === "tactical" && isSupporter(c);
    });
    if (view.deckCount > CYCLE_DECK_RESERVE) {
      if (!tacticalSupporterInHand && wantsDrawRefresh(view)) {
        const drawMove = legal.find((m) => specOf(m)?.phase === "draw");
        if (drawMove) return drawMove;
        const drawEffects = legal.filter(
          (m): m is EffectMove =>
            m.kind === "effect" && effectMovePhase(m.card, m.effectIndex) === "draw",
        );
        const drawEffect = chooseEffectMove(view, drawEffects);
        if (drawEffect) return drawEffect;
        const supporter = legal.find((m) => m.kind === "cycle_supporter");
        if (supporter) return supporter;
      }
      if (wantsSearch(view) || sloppy) {
        const searches = legal.filter(
          (m): m is PlayTrainerMove => specOf(m)?.phase === "search",
        );
        if (searches.length > 0) {
          return sloppy ? searches[0] : bestSearchTrainer(view, searches);
        }
        // Declarative search cards (Team Rocket's Transceiver, …) — info phase.
        const searchEffects = legal.filter(
          (m): m is EffectMove =>
            m.kind === "effect" && effectMovePhase(m.card, m.effectIndex) === "search",
        );
        const searchEffect = chooseEffectMove(view, searchEffects);
        if (searchEffect) return searchEffect;
      }
      const item = legal.find((m) => m.kind === "cycle_item");
      if (item) return item;
      if (tacticalSupporterInHand === false) {
        const supporter = legal.find((m) => m.kind === "cycle_supporter");
        if (supporter) return supporter;
      }
    }

    // Phase 3 — the searched plan.
    if (this.queue.length === 0) {
      this.queue = this.planTurn(view, legal);
    }
    const next = this.queue.shift();
    if (next && isStillLegal(next, legal)) return next;
    this.queue = [];
    return { kind: "pass" };
  }

  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }

  /** Does this pilot play the FREE-DEVELOPMENT phase sloppily this turn?
   *
   *  Development (bench choice, energy acceleration, which card a search
   *  fetches) happens outside the plan search, so it used to be played
   *  perfectly at every difficulty. That was tolerable while those branches
   *  were naive; once they got good, the easy bot got good with them and the
   *  difficulty ladder compressed — `medium beats easy` fell to exactly 60%
   *  and the strength-ladder test caught it.
   *
   *  The difficulty model is "one engine, strength = how faithfully it picks
   *  the best-scored play", so development must be on the same dial. Reuses
   *  the existing epsilon rather than inventing a second knob, and is seeded
   *  per turn so replays stay deterministic. */
  private sloppyDevelopment(view: PlayerView): boolean {
    if (this.params.epsilon <= 0) return false;
    const rng = mulberry32((this.seed ^ Math.imul(view.turn.number + 1, 0x27d4eb2f)) >>> 0);
    // sqrt spreads the LOW end: a weak pilot misplays development far more
    // often than it outright blunders a whole turn, and development errors
    // (benching the wrong basic, never accelerating) are precisely what
    // distinguishes a beginner. Concave, so `hard` stays at ~0.
    return rng() < Math.sqrt(this.params.epsilon);
  }

  /* ── Plan search ─────────────────────────────────────────────── */

  private planTurn(view: PlayerView, legal: SimMove[]): SimMove[] {
    const rng = mulberry32((this.seed ^ Math.imul(view.turn.number + 1, 0x9e3779b9)) >>> 0);
    let candidates = this.enumerate(view, legal);
    if (candidates.length === 0) return [{ kind: "pass" }];
    candidates = this.deepen(view, candidates);

    // ε-random: outright blunder chance (easy mode's signature).
    if (rng() < this.params.epsilon) {
      return candidates[Math.floor(rng() * candidates.length)].moves;
    }

    // Softmax over scores. τ→0 degenerates to argmax.
    const tau = Math.max(0.01, this.params.temperature);
    const maxScore = Math.max(...candidates.map((c) => c.score));
    const weights = candidates.map((c) => Math.exp((c.score - maxScore) / tau));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i].moves;
    }
    return candidates[candidates.length - 1].moves;
  }

  /** Selective deepening. Full 3-ply on every candidate would blow the
   *  interactive latency budget, so the cheap 1-ply score acts as a PRIOR:
   *  it picks the few most promising lines, and only those are re-scored with
   *  our-turn -> their-reply -> our-follow-up. Softmax then runs over the
   *  re-scored set alone, because 1-ply and 3-ply scores are different
   *  horizons and must never be compared against each other.
   *
   *  (This is the seam where the learned policy ranker belongs later: a
   *  better prior means the same budget explores better lines.)
   *
   *  Returns candidates unchanged when deepening is disabled. */
  private deepen(view: PlayerView, candidates: CandidatePlan[]): CandidatePlan[] {
    const k = this.deepenTopK;
    if (k <= 0 || candidates.length <= 1) return candidates;

    const ghost = buildGhostState(view);
    const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, k);
    const deepened: CandidatePlan[] = [];
    for (const cand of top) {
      const deep = this.deepScore(ghost, cand.moves, view);
      // Keep the same tempo shaping the 1-ply score carried, so the two
      // horizons stay on a comparable scale within the re-ranked set.
      if (deep !== null) deepened.push({ moves: cand.moves, score: deep - cand.tempo, tempo: cand.tempo });
    }
    return deepened.length > 0 ? deepened : candidates;
  }

  private moveSpec(view: PlayerView, m: SimMove): TrainerSpec | null {
    if (m.kind !== "play_trainer") return null;
    const card = view.hand.find((c) => c.id === m.cardId);
    return card ? trainerSpec(card) : null;
  }

  private enumerate(view: PlayerView, legal: SimMove[]): CandidatePlan[] {
    // Ghost always models the acting side as sides.player (see
    // buildGhostState), so plans are applied from that fixed seat.
    const ghost = buildGhostState(view);

    // Attach options: one per distinct (provided type, target).
    const attachMoves: (SimMove | null)[] = [null];
    const seenAttach = new Set<string>();
    for (const m of legal) {
      if (m.kind !== "attach") continue;
      const card = view.hand.find((c) => c.id === m.cardId);
      const provides = card ? energyProvides(card) : null;
      const key = `${provides}→${m.targetId}`;
      if (provides && !seenAttach.has(key)) {
        seenAttach.add(key);
        attachMoves.push(m);
      }
    }

    // Switch acts as a free retreat; both share the "reposition" slot.
    const retreatMoves: (SimMove | null)[] = [null];
    for (const m of legal) if (m.kind === "retreat") retreatMoves.push(m);
    for (const m of legal) {
      if (m.kind === "play_trainer" && this.moveSpec(view, m)?.effect.kind === "switch_active") {
        retreatMoves.push(m);
      }
    }

    // Boss's Orders (gust): a public-information tactical supporter —
    // enumerated as an outermost dimension. Null-gust plans enumerate
    // first so baseline lines always exist inside the candidate cap;
    // gust plans skip the reposition slot (our own active is unaffected).
    const gustMoves: (SimMove | null)[] = [null];
    for (const m of legal) {
      if (m.kind === "play_trainer" && this.moveSpec(view, m)?.effect.kind === "gust") {
        gustMoves.push(m);
      }
    }

    const plans: CandidatePlan[] = [];
    const turnProbe: ProbeCandidate[] = [];
    const record = (leaf: number, tempo: number) => {
      if (PROBE) {
        turnProbe.push({
          evalPart: this.probeEval,
          tacticalPart: leaf - this.probeEval,
          total: leaf - tempo,
        });
      }
    };
    outer: for (const gust of gustMoves) {
      for (const attach of attachMoves) {
        for (const retreat of gust ? [null] : retreatMoves) {
          // Attack options depend on the post-gust/attach/retreat active,
          // so expand them inside the ghost application.
          const base: SimMove[] = [];
          if (gust) base.push(gust);
          if (attach) base.push(attach);
          if (retreat) base.push(retreat);
          const afterBase = applyPlanToGhost(ghost, base);
          if (!afterBase) continue;

          const active = afterBase.sides.player.active;
          const attackOptions: (SimMove | null)[] = [null];
          if (active && afterBase.turn.number > 1) {
            for (const { index } of usableAttacks(active)) {
              attackOptions.push({ kind: "attack", attackIndex: index });
            }
          }

          for (const attack of attackOptions) {
            const moves = [...base, ...(attack ? [attack] : []), ...(attack ? [] : [{ kind: "pass" } as SimMove])];
            const end = applyPlanToGhost(ghost, moves);
            if (!end) continue;
            const tempo =
              (retreat && retreat.kind === "retreat" ? this.tactical.retreatTempo : 0) +
              (attack ? 0 : this.tactical.noAttackTempo) -
              (attach ? this.tactical.attachTiebreak : 0);
            const leaf = this.scoreEndState(end, view);
            plans.push({ moves, score: leaf - tempo, tempo });
            record(leaf, tempo);
            if (plans.length >= this.params.maxCandidates) break outer;
          }
        }
      }
    }

    // Policy prior: the HeuristicPolicy's line for this turn rides along
    // as one more scored candidate. The search can only improve on it —
    // the planner is never meaningfully weaker than the hand-written
    // policy, and beats it wherever the evaluator finds a better line.
    const shadow = heuristicShadowPlan(ghost);
    if (shadow.length > 0) {
      const end = applyPlanToGhost(ghost, shadow);
      if (end) {
        const tempo =
          (shadow.some((m) => m.kind === "attack") ? 0 : this.tactical.noAttackTempo) -
          (shadow.some((m) => m.kind === "attach") ? this.tactical.attachTiebreak : 0);
        const leaf = this.scoreEndState(end, view);
        plans.push({ moves: shadow, score: leaf - tempo, tempo });
        record(leaf, tempo);
      }
    }
    if (PROBE && turnProbe.length > 0) PROBE.push(turnProbe);
    return plans;
  }

  /** Ply 1 + opponent reply: our plan's end state, then their best answer. */
  private scoreEndState(end: GameState, view: PlayerView): number {
    this.probeEval = Number.NaN;
    // Outright win/loss dominates every tactical adjustment.
    if (end.winner === "player") return 10;
    if (end.winner === "opponent") return -10;

    // Materialize the opponent's reply (their board is public information) so
    // exchange races are priced — "if I stay, they KO me and bank prizes"
    // shows up in the evaluation instead of a hand-tuned dodge penalty.
    simulateOpponentReply(end, this.replyChooser);
    if (end.winner === "opponent") return -10;
    if (end.winner === "player") return 10;
    return this.leafScore(end, view);
  }

  /** Static evaluation of a settled state — no further lookahead. */
  private leafScore(end: GameState, view: PlayerView): number {
    if (end.winner === "player") return 10;
    if (end.winner === "opponent") return -10;

    const self = end.sides.player;
    const opp = end.sides.opponent;
    const snapshot: PlanSnapshot = {
      prize_diff: end.prizesTaken.player - end.prizesTaken.opponent,
      prizes_total: end.prizesTaken.player + end.prizesTaken.opponent,
      turn_number: end.turn.number,
      bench_diff: self.bench.length - opp.bench.length,
      hand_diff: self.hand.length - opp.hand.length,
      went_first: view.wentFirst === null ? 0.5 : view.wentFirst ? 1 : 0,
      is_player_turn: 1,
    };
    // The ghost seats the acting side at sides.player, so ghostView(end) is
    // this plan's post-reply information set from our perspective — exactly
    // what a board-aware evaluator scores.
    let score = this.evaluate(snapshot, ghostView(end));
    if (PROBE) this.probeEval = score;

    // Banked prizes beat any positional bonus (see PRIZE_CONVERSION_BONUS).
    score += this.tactical.prizeConversion * Math.max(0, end.prizesTaken.player - view.prizesTaken);

    // Tactical adjustments from public information only.
    const ourActive = self.active;
    const theirActive = opp.active;
    if (ourActive && theirActive) {
      // Progress toward knocking out their current active (chip damage is
      // invisible to the prize-based evaluator otherwise).
      const theirHp = theirActive.card.catalog?.hp ?? 120;
      score += this.tactical.damageProgress * Math.min(1, theirActive.damage / theirHp);

      // Threat: our active could take the KO next turn as the board stands.
      // Estimate THROUGH the declarative path: attacks whose damage lives in
      // a formula or rider print as "" and score 0 on computeDamage alone.
      // v18 fixed exactly this in HeuristicPolicy and the planner never got
      // it — so the pilot the calibration gate uses could not see the damage
      // of any card W3 made real. N's Zoroark's Night Joker is the extreme
      // case: it prints nothing and IS the deck.
      const ourBest = Math.max(
        0,
        ...usableAttacks(ourActive).map(({ attack, index }) =>
          Math.max(
            computeDamage(ourActive, attack, theirActive),
            estimatedAttackDamage(ourActive, index, undefined, "player", {
              ownBench: self.bench,
              oppActive: theirActive,
            }),
          ),
        ),
      );
      if (ourBest >= remainingHp(theirActive)) score += this.tactical.koThreat;
    }
    if (ourActive && usableAttacks(ourActive).length > 0) score += this.tactical.activeReady;

    // Energy investment: progress toward each mon's strongest attack.
    // Makes concentrating on a big attacker beat enabling a weak one, and
    // makes retreat costs (discarded progress) real.
    let investment = 0;
    for (const mon of [self.active, ...self.bench]) {
      if (!mon) continue;
      let best = 0;
      const monAttacks = mon.card.catalog?.attacks ?? [];
      for (let ai = 0; ai < monAttacks.length; ai++) {
        const attack = monAttacks[ai];
        // Same blindness as above: an attack that prints "" is not worthless,
        // so energy invested toward it is not wasted investment.
        const dmg = Math.max(
          baseDamage(attack),
          estimatedAttackDamage(mon, ai, undefined, "player", {
            ownBench: self.bench,
            oppActive: opp.active,
          }),
        );
        if (dmg <= 0 || attack.cost.length === 0) continue;
        const progress = costProgress(mon, attack.cost);
        // Convex in progress: the marginal energy is worth more the closer
        // an attacker is to completion, so concentrating beats spreading —
        // this is what makes the bot COMMIT to one attacker across turns.
        best = Math.max(best, progress * progress * Math.min(1, dmg / 150));
      }
      investment += best;
    }
    score += this.tactical.attackInvestment * investment;
    return score;
  }

  /** Ply 3: the best static score we can reach on our NEXT turn from `state`
   *  (our turn to move). Bounded by FOLLOWUP_CANDIDATE_CAP.
   *
   *  Only board-driven lines are enumerated — attach / retreat / attack from
   *  the cards already in hand. The ghost's deck is unrevealed placeholders,
   *  so the turn-start draw cannot be modeled; this is therefore a LOWER
   *  bound on next turn (we may draw better), which is the safe direction:
   *  it never invents resources we might not have. */
  private followupScore(state: GameState, view: PlayerView): number {
    // PLY PARITY. Every leaf must be measured at the same point in the turn
    // cycle as the 1-ply score — i.e. AFTER an opponent reply. Scoring our
    // follow-up attack statically instead would evaluate odd-parity states
    // ("we just swung, nothing has answered yet"), systematically flattering
    // any line that sets up an attack we never see punished. Mixing parities
    // is why naive deepening plays WORSE than not deepening at all.
    //
    // A follow-up turn is a NEW turn, so the per-turn allowances reset the
    // way beginTurn() would: energy attachment, the supporter slot, and the
    // evolve-this-turn locks. Without this the follow-up inherits whatever
    // the current plan already spent and badly undervalues next turn — the
    // plan that attaches now would be scored as unable to attach again.
    // (The turn-start draw is NOT modeled: the ghost deck is unrevealed
    // placeholders, so next turn's new resources stay invisible. That makes
    // this a lower bound, which is the safe direction.)
    const self = state.sides.player;
    self.energyAttachedThisTurn = 0;
    self.supporterPlayedThisTurn = false;
    self.supporterNamePlayedThisTurn = undefined;
    for (const mon of [self.active, ...self.bench]) if (mon) mon.evolvedThisTurn = false;

    // Doing nothing next turn is always available, and is the floor. Clone
    // first — scoreEndState mutates the state it is handed.
    let best = this.scoreEndState(buildGhostState(ghostView(state)), view);
    if (!state.sides.player.active) return best;

    const ctx: TurnContext = { retreated: false };
    const legal = legalMoves(state, "player", ctx);

    const attaches: (SimMove | null)[] = [null];
    const seenAttach = new Set<string>();
    for (const m of legal) {
      if (m.kind !== "attach") continue;
      if (seenAttach.has(m.targetId)) continue;
      seenAttach.add(m.targetId);
      attaches.push(m);
    }
    const retreats: (SimMove | null)[] = [null];
    for (const m of legal) if (m.kind === "retreat") retreats.push(m);

    let evaluated = 0;
    for (const attach of attaches) {
      for (const retreat of retreats) {
        const base: SimMove[] = [];
        if (attach) base.push(attach);
        if (retreat) base.push(retreat);
        const afterBase = base.length ? applyPlanToGhost(state, base) : state;
        if (!afterBase) continue;
        const active = afterBase.sides.player.active;
        if (!active) continue;
        for (const { index } of usableAttacks(active)) {
          const end = applyPlanToGhost(state, [...base, { kind: "attack", attackIndex: index }]);
          if (!end) continue;
          if (end.winner === "player") return 10;
          // scoreEndState folds in their answer, keeping this leaf even-parity.
          best = Math.max(best, this.scoreEndState(end, view));
          if (++evaluated >= FOLLOWUP_CANDIDATE_CAP) return best;
        }
      }
    }
    return best;
  }

  /** Full 3-ply score for one plan: our turn -> their best reply -> our best
   *  follow-up. Returns null when the plan is inapplicable. */
  private deepScore(ghost: GameState, moves: SimMove[], view: PlayerView): number | null {
    const end = applyPlanToGhost(ghost, moves);
    if (!end) return null;
    if (end.winner === "player") return 10;
    if (end.winner === "opponent") return -10;
    simulateOpponentReply(end, this.replyChooser);
    if (end.winner === "player") return 10;
    if (end.winner === "opponent") return -10;
    return this.followupScore(end, view);
  }
}

function isStillLegal(move: SimMove, legal: SimMove[]): boolean {
  return legal.some((m) => JSON.stringify(m) === JSON.stringify(move));
}

/** Heuristic pick among deck/discard search plays: fetch the card with the
 *  best attack ceiling, with a big bonus for evolutions of Pokémon already
 *  in play (they convert to board power immediately). Deterministic. */

/** Mutate a ghost end-state with the opponent's best reply, using PUBLIC
 *  information only (their hand is unrevealed placeholders in the ghost, so
 *  no attach/draw/trainer modeling — but their whole board is visible).
 *
 *  Two fidelity points the earlier attack-only version missed, both of which
 *  drive exchange pricing:
 *
 *  1. RETREAT. Retreating spends the ACTIVE's attached energy and the
 *     incoming Pokémon keeps its own, so it needs no hand information: any
 *     benched attacker is reachable whenever the active can pay the cost. A
 *     weak wall parked in front of a big benched threat used to read as
 *     "safe to stay" — exactly the trade the planner most needs to see. The
 *     chosen line also leaves their board as it really would be, so our
 *     next-turn threat assessment evaluates against the right active.
 *  2. REAL RULES. The reply is applied through applyMove instead of
 *     hand-rolled damage, so state-scaled damage, weakness/resistance,
 *     attack effects (bench counters/damage), inflicted conditions, KOs,
 *     prizes and win detection all match what would actually happen.
 *
 *  Deliberately pessimistic — it assumes the opponent finds their best line.
 *  Over-optimism here is what walks a planner into counter-KOs. */
function simulateOpponentReply(end: GameState, chooser: ReplyChooser | null = null): void {
  const oppSide = end.sides.opponent;
  const defender = end.sides.player.active;
  if (!oppSide.active || !defender) return;

  const ctx: TurnContext = { retreated: false };
  const finish = (attackIndex: number): void => {
    const result = applyMove(end, "opponent", { kind: "attack", attackIndex }, ctx);
    for (const side of end.winner === null ? result.pendingPromotions : []) {
      promote(end, side, promoteBest(end.sides[side].bench));
    }
  };

  if (chooser) {
    // Learned reply: offer every public-information option — all usable
    // attacks (including 0-damage condition attacks the hardest-hit rule
    // can't see the point of) plus retreats to any battle-ready bench mon —
    // and let the ranker pick. A retreat pick gets one follow-up attack
    // choice from the new active; a null/pass-shaped pick ends the reply.
    const options: SimMove[] = usableAttacks(oppSide.active).map(({ index }) => ({
      kind: "attack",
      attackIndex: index,
    }));
    if (canRetreat(oppSide.active)) {
      oppSide.bench.forEach((mon, i) => {
        if (usableAttacks(mon).length > 0) options.push({ kind: "retreat", benchIndex: i });
      });
    }
    if (options.length > 0) {
      let choice = chooser(viewFor(end, "opponent"), options);
      if (PROBE && choice && options.length > 1) {
        // Would the hardest-hit rule have made the same first pick? Map its
        // best line onto the same option universe (retreat target or attack).
        const dmg = (mon: PokemonInPlay, ai: number): number => {
          const atk = mon.card.catalog?.attacks[ai];
          return atk ? computeDamage(mon, atk, defender) : 0;
        };
        let bestDamage = -1;
        let bestOption: SimMove | null = null;
        for (const opt of options) {
          const d =
            opt.kind === "attack"
              ? dmg(oppSide.active, opt.attackIndex)
              : opt.kind === "retreat"
                ? Math.max(0, ...usableAttacks(oppSide.bench[opt.benchIndex]).map(({ index }) =>
                    dmg(oppSide.bench[opt.benchIndex], index)))
                : 0;
          // Strict > keeps the stay-in-place tie preference: attacks are
          // enumerated before retreats in `options`.
          if (d > bestDamage) {
            bestDamage = d;
            bestOption = opt;
          }
        }
        REPLY_AGREEMENT.total += 1;
        if (
          bestOption &&
          bestOption.kind === choice.kind &&
          (choice.kind !== "attack" ||
            (bestOption as { attackIndex: number }).attackIndex ===
              (choice as { attackIndex: number }).attackIndex) &&
          (choice.kind !== "retreat" ||
            (bestOption as { benchIndex: number }).benchIndex ===
              (choice as { benchIndex: number }).benchIndex)
        ) {
          REPLY_AGREEMENT.agree += 1;
        }
      }
      if (choice?.kind === "retreat") {
        applyMove(end, "opponent", choice, ctx);
        const active = oppSide.active;
        const attacks: SimMove[] = active
          ? usableAttacks(active).map(({ index }) => ({ kind: "attack", attackIndex: index }))
          : [];
        if (attacks.length === 0) return;
        choice =
          attacks.length === 1 ? attacks[0] : chooser(viewFor(end, "opponent"), attacks) ?? attacks[0];
      }
      if (choice?.kind === "attack") finish(choice.attackIndex);
      if (choice !== null) return;
      // chooser declined outright — fall through to the hardest-hit rule.
    }
  }

  const linesFrom = (mon: PokemonInPlay, benchIndex: number | null) =>
    usableAttacks(mon).map(({ attack, index }) => ({
      benchIndex,
      attackIndex: index,
      damage: Math.max(
        computeDamage(mon, attack, defender),
        estimatedAttackDamage(mon, index, undefined, "opponent", {
          ownBench: oppSide.bench,
          oppActive: defender,
        }),
      ),
    }));

  const lines = linesFrom(oppSide.active, null);
  if (canRetreat(oppSide.active)) {
    oppSide.bench.forEach((mon, i) => lines.push(...linesFrom(mon, i)));
  }
  const scoring = lines.filter((l) => l.damage > 0);
  if (scoring.length === 0) return;
  // Hardest hit wins; on a tie keep the active in place, since retreating
  // would cost them energy for no extra damage.
  const best = scoring.reduce((a, b) =>
    b.damage > a.damage || (b.damage === a.damage && a.benchIndex !== null && b.benchIndex === null)
      ? b
      : a,
  );

  if (best.benchIndex !== null) {
    applyMove(end, "opponent", { kind: "retreat", benchIndex: best.benchIndex }, ctx);
  }
  finish(best.attackIndex);
}

/* ─── Ghost state (determinized sandbox from the view) ──────────── */

function cloneCard(c: CardInstance): CardInstance {
  return { ...c }; // catalog back-pointer intentionally shared
}

function cloneMon(m: PokemonInPlay): PokemonInPlay {
  return {
    ...m,
    card: cloneCard(m.card),
    stack: m.stack.map(cloneCard),
    attachedEnergy: m.attachedEnergy.map(cloneCard),
    attachedTools: m.attachedTools.map(cloneCard),
    conditions: [...m.conditions],
    abilitiesUsedThisTurn: [...m.abilitiesUsedThisTurn],
  };
}

function placeholders(n: number): CardInstance[] {
  return Array.from({ length: n }, () => makeUnrevealed("ghost"));
}

/** Rebuild a playable GameState from a PlayerView. The acting side sits at
 *  sides.player; every hidden zone is unrevealed placeholders, so nothing
 *  the real state knows can leak into plan evaluation. */
export function buildGhostState(view: PlayerView): GameState {
  return {
    engineVersion: ENGINE_VERSION,
    turn: { ...view.turn, actor: "player" },
    firstPlayer: view.wentFirst === null ? null : view.wentFirst ? "player" : "opponent",
    stadium: null,
    sides: {
      player: {
        handle: "ghost-self",
        deck: placeholders(view.deckCount),
        hand: view.hand.map(cloneCard),
        discard: view.discard.map(cloneCard),
        lostZone: view.lostZone.map(cloneCard),
        prizes: placeholders(view.prizeCount),
        active: view.board.active ? cloneMon(view.board.active) : null,
        bench: view.board.bench.map(cloneMon),
        mulligans: view.mulligans,
        energyAttachedThisTurn: view.energyAttachedThisTurn,
        supporterPlayedThisTurn: view.supporterPlayedThisTurn,
      },
      opponent: {
        handle: "ghost-opp",
        deck: placeholders(view.opponent.deckCount),
        hand: placeholders(view.opponent.handCount),
        discard: view.opponent.discard.map(cloneCard),
        lostZone: view.opponent.lostZone.map(cloneCard),
        prizes: placeholders(view.opponent.prizeCount),
        active: view.opponent.board.active ? cloneMon(view.opponent.board.active) : null,
        bench: view.opponent.board.bench.map(cloneMon),
        mulligans: view.opponent.mulligans,
        energyAttachedThisTurn: 0,
        supporterPlayedThisTurn: false,
      },
    },
    prizesTaken: { player: view.prizesTaken, opponent: view.opponent.prizesTaken },
    winner: null,
    endReason: null,
  };
}

/** Play the HeuristicPolicy's whole turn on a ghost clone and record the
 *  moves it takes (bench/evolve/cycles were already executed by the
 *  planner's earlier phases, so this is the consequential tail). */
function heuristicShadowPlan(ghost: GameState): SimMove[] {
  const state = buildGhostState(ghostView(ghost));
  const policy = new HeuristicPolicy();
  const ctx: TurnContext = { retreated: false };
  const moves: SimMove[] = [];
  for (let i = 0; i < 12; i++) {
    const legal = legalMoves(state, "player", ctx);
    const move = policy.chooseMove(ghostView(state), legal, ctx);
    if (!isStillLegal(move, legal)) break;
    moves.push(move);
    const result = applyMove(state, "player", move, ctx);
    if (state.winner === null) {
      for (const side of result.pendingPromotions) {
        promote(state, side, promoteBest(state.sides[side].bench));
      }
    }
    if (result.turnEnded || state.winner !== null) break;
  }
  return moves;
}

/** Apply a move sequence to a fresh clone of the ghost. Null when a move
 *  turns out inapplicable (defensive — enumeration derives from legal moves). */
function applyPlanToGhost(ghost: GameState, moves: SimMove[]): GameState | null {
  const state = buildGhostState(ghostView(ghost));
  const ctx: TurnContext = { retreated: false };
  for (const move of moves) {
    const legal = legalMoves(state, "player", ctx);
    if (!isStillLegal(move, legal)) return null;
    const result = applyMove(state, "player", move, ctx);
    if (state.winner === null) {
      for (const side of result.pendingPromotions) {
        promote(state, side, promoteBest(state.sides[side].bench));
      }
    }
  }
  return state;
}

/** Cheap re-view of a ghost (already redacted) for re-cloning. */
function ghostView(ghost: GameState): PlayerView {
  return {
    actor: "player",
    turn: ghost.turn,
    wentFirst: ghost.firstPlayer === null ? null : ghost.firstPlayer === "player",
    hand: ghost.sides.player.hand,
    board: { active: ghost.sides.player.active, bench: ghost.sides.player.bench },
    discard: ghost.sides.player.discard,
    lostZone: ghost.sides.player.lostZone,
    deckCount: ghost.sides.player.deck.length,
    prizeCount: ghost.sides.player.prizes.length,
    prizesTaken: ghost.prizesTaken.player,
    mulligans: ghost.sides.player.mulligans,
    // Ghost decks/prizes are unrevealed placeholders — no composition to infer.
    unseenOwn: {},
    energyAttachedThisTurn: ghost.sides.player.energyAttachedThisTurn,
    supporterPlayedThisTurn: ghost.sides.player.supporterPlayedThisTurn,
    retreatUsedThisTurn: false,
    stadiumPlayedThisTurn: false,
    stadiumEffectUsedThisTurn: false,
    stadium: ghost.stadium
      ? { name: ghost.stadium.card.name, owner: ghost.stadium.owner }
      : null,
    opponent: {
      board: { active: ghost.sides.opponent.active, bench: ghost.sides.opponent.bench },
      discard: ghost.sides.opponent.discard,
      lostZone: ghost.sides.opponent.lostZone,
      handCount: ghost.sides.opponent.hand.length,
      deckCount: ghost.sides.opponent.deck.length,
      prizeCount: ghost.sides.opponent.prizes.length,
      prizesTaken: ghost.prizesTaken.opponent,
      mulligans: ghost.sides.opponent.mulligans,
    },
  };
}
