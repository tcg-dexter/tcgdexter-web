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
  legalMoves,
  remainingHp,
  usableAttacks,
  type SimMove,
  type TurnContext,
} from "./moves";
import { HeuristicPolicy, chooseAbilityMove, promoteBest, type DecisionPolicy } from "./policy";
import { energyProvides, energyUnits, prizeValue } from "./setup";
import { isSupporter, trainerSpec, type PlayTrainerMove, type TrainerSpec } from "./trainers";
import { lookupCard } from "../catalog";
import { makeUnrevealed } from "../initial";
import { mulberry32 } from "./rng";
import type { PlayerView } from "./view";

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

export interface PlannerOptions {
  params: PlannerParams;
  seed: number;
  evaluate?: StateEvaluator;
  /** Overrides merged over DEFAULT_TACTICAL_WEIGHTS. */
  tactical?: Partial<TacticalWeights>;
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
}

export class PlannerPolicy implements DecisionPolicy {
  private readonly params: PlannerParams;
  private readonly evaluate: StateEvaluator;
  private readonly seed: number;
  private readonly tactical: TacticalWeights;
  private queue: SimMove[] = [];
  private plannedTurn = -1;

  constructor(options: PlannerOptions) {
    this.params = options.params;
    this.evaluate = options.evaluate ?? heuristicEvaluator;
    this.seed = options.seed >>> 0;
    this.tactical = { ...DEFAULT_TACTICAL_WEIGHTS, ...options.tactical };
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
    const bench = legal.find((m) => m.kind === "bench");
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
      if (!tacticalSupporterInHand && view.hand.length <= 5) {
        const drawMove = legal.find((m) => specOf(m)?.phase === "draw");
        if (drawMove) return drawMove;
        const supporter = legal.find((m) => m.kind === "cycle_supporter");
        if (supporter) return supporter;
      }
      const searches = legal.filter(
        (m): m is PlayTrainerMove => specOf(m)?.phase === "search",
      );
      if (searches.length > 0) return bestSearchMove(view, searches);
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

  /* ── Plan search ─────────────────────────────────────────────── */

  private planTurn(view: PlayerView, legal: SimMove[]): SimMove[] {
    const rng = mulberry32((this.seed ^ Math.imul(view.turn.number + 1, 0x9e3779b9)) >>> 0);
    const candidates = this.enumerate(view, legal);
    if (candidates.length === 0) return [{ kind: "pass" }];

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
            plans.push({ moves, score: this.scoreEndState(end, view) - tempo });
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
        plans.push({ moves: shadow, score: this.scoreEndState(end, view) - tempo });
      }
    }
    return plans;
  }

  private scoreEndState(end: GameState, view: PlayerView): number {
    // Outright win/loss dominates every tactical adjustment.
    if (end.winner === "player") return 10;
    if (end.winner === "opponent") return -10;

    // Two-ply-lite: materialize the opponent's reply attack (their active's
    // usable attacks are public information) so exchange races are priced —
    // "if I stay, they KO me and bank prizes" shows up in the evaluation
    // instead of a hand-tuned dodge penalty.
    simulateOpponentReply(end);
    if (end.winner === "opponent") return -10;
    if (end.winner === "player") return 10;

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
      const ourBest = Math.max(
        0,
        ...usableAttacks(ourActive).map(({ attack }) =>
          computeDamage(ourActive, attack, theirActive),
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
      for (const attack of mon.card.catalog?.attacks ?? []) {
        const dmg = baseDamage(attack);
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
}

function isStillLegal(move: SimMove, legal: SimMove[]): boolean {
  return legal.some((m) => JSON.stringify(m) === JSON.stringify(move));
}

/** Fraction of an attack's cost payable right now — the typed mirror of
 *  canPayCost (moves.ts). Count-based progress credited dead energy: a
 *  Psychic on a Lightning attacker read as investment, so the planner
 *  happily banked energy its attacker could never spend. */
function costProgress(mon: PokemonInPlay, cost: string[]): number {
  if (cost.length === 0) return 0;
  const pool = mon.attachedEnergy.flatMap(energyUnits);
  let paid = 0;
  for (const req of cost) {
    if (req === "Colorless") continue;
    let idx = pool.indexOf(req);
    if (idx === -1) idx = pool.indexOf("Any");
    if (idx === -1) continue;
    pool.splice(idx, 1);
    paid += 1;
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  paid += Math.min(pool.length, colorless);
  return paid / cost.length;
}

/** Heuristic pick among deck/discard search plays: fetch the card with the
 *  best attack ceiling, with a big bonus for evolutions of Pokémon already
 *  in play (they convert to board power immediately). Deterministic. */
function bestSearchMove(view: PlayerView, moves: PlayTrainerMove[]): PlayTrainerMove {
  const inPlayNames = new Set(
    [view.board.active, ...view.board.bench].filter(Boolean).map((m) => m!.card.name),
  );
  const scoreName = (name: string): number => {
    const card = lookupCard(name);
    if (!card) return 0;
    if (card.supertype === "Energy") return 25;
    if (card.supertype === "Trainer") return 20;
    const ceiling = Math.max(0, ...card.attacks.map((a) => parseInt(a.damage, 10) || 0));
    const evolvesInPlay = card.evolves_from && inPlayNames.has(card.evolves_from) ? 200 : 0;
    return ceiling + evolvesInPlay;
  };
  let best = moves[0];
  let bestScore = -1;
  for (const move of moves) {
    const names = move.deckCardNames ?? (move.discardPickName ? [move.discardPickName] : []);
    const score = names.reduce((s, n) => s + scoreName(n), names.length === 0 ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/** Mutate a ghost end-state with the opponent's best reply attack (public
 *  info only — no attach/draw modeling for their hidden hand). KOs resolve
 *  with promoteBest so the exchange's prize swing lands in the evaluation. */
function simulateOpponentReply(end: GameState): void {
  const attacker = end.sides.opponent.active;
  const defender = end.sides.player.active;
  if (!attacker || !defender) return;
  const best = usableAttacks(attacker)
    .map(({ attack }) => computeDamage(attacker, attack, defender))
    .reduce((a, b) => Math.max(a, b), 0);
  if (best <= 0) return;
  defender.damage += best;
  if (remainingHp(defender) > 0) return;

  const side = end.sides.player;
  side.discard.push(defender.card, ...defender.stack, ...defender.attachedEnergy, ...defender.attachedTools);
  side.active = null;
  const taken = end.sides.opponent.prizes.splice(0, prizeValue(defender.card.name));
  end.sides.opponent.hand.push(...taken);
  end.prizesTaken.opponent += taken.length;
  if (end.prizesTaken.opponent >= 6) {
    end.winner = "opponent";
    end.endReason = "prizes";
    return;
  }
  if (side.bench.length === 0) {
    end.winner = "opponent";
    end.endReason = "no_active";
    return;
  }
  promote(end, "player", promoteBest(side.bench));
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
    if (result.pendingPromotion && state.winner === null) {
      promote(state, result.pendingPromotion, promoteBest(state.sides[result.pendingPromotion].bench));
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
    if (result.pendingPromotion && state.winner === null) {
      promote(state, result.pendingPromotion, promoteBest(state.sides[result.pendingPromotion].bench));
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
