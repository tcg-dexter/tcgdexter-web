// What the opponent can do to us NEXT turn — including the board they do not
// have yet.
//
// THE MISREAD THIS EXISTS TO FIX
//
// Every feature the models see today describes the board as it IS. An
// opponent showing N's Zorua encodes as a 70 HP Basic whose only attack does
// 20 — harmless. One turn later it is N's Zoroark ex, 280 HP, and Night Joker
// copies an attack off their own bench for whatever that bench is holding.
// A planner that scored the first board as safe walked into the second.
//
// Route planning is precisely the thing that cannot afford this. A route is a
// claim about the next several turns, so it has to be priced against the
// opponent's next several turns, not their current one.
//
// THREE PROJECTIONS, cheapest first:
//
//   now       best attack they can pay for with energy already attached.
//   evolve    max over the legal evolutions of each Pokémon they have in
//             play. This is the Zorua case, and it is knowable exactly —
//             lib/ml/format's evolution index is derived from the format
//             pool, so it never suggests a rotated evolution.
//   attach    the same, granting one more energy attachment for the turn.
//
// COPY ATTACKS. Night Joker prints NO damage number: it copies an attack
// from a benched Pokémon. `baseDamage` reads it as 0, so a naive "max printed
// damage" projection scores the format's premier attacker as a blank. When an
// attack copies, we price it at the best attack on the copier's own side of
// the board — which is what the engine actually resolves.
//
// Everything here is an UPPER BOUND on one turn of opponent progress, not a
// prediction. It deliberately ignores whether they hold the evolution card;
// lib/ml/features/metaPrior.ts supplies that probability separately, and
// keeping "what is possible" apart from "what is likely" means a wrong prior
// can never hide a real threat.

import type { PlayerView } from "@/lib/engine/sim/view";
import type { EngineAttack, EngineCard, PokemonInPlay } from "@/lib/engine/types";
import { baseDamage, remainingHp, usableAttacks } from "@/lib/engine/sim/moves";
import { unitPaysType } from "@/lib/engine/sim/effects/energy";
import { energyUnits } from "@/lib/engine/sim/setup";
import { effectiveMaxHp } from "@/lib/engine/sim/tools";
import { evolutionsOf, legalCard } from "@/lib/ml/format";
import { mechanicsOf } from "./cardMechanics";

/** Bump with any change to THREAT_FIELDS. */
export const THREAT_VERSION = 1;

export interface Threat {
  /** Best damage they can deal right now, energy already paid. */
  now: number;
  /** Best damage after one legal evolution off their current board. */
  after_evolve: number;
  /** Best damage after one evolution AND one energy attachment. */
  after_attach: number;
  /** after_attach − now: how much worse next turn can get. */
  escalation: number;
  /** 1 when their projected best kills our active. */
  kos_our_active: number;
  /** 1 when it kills our active only after they evolve — the Zorua signal. */
  ko_needs_evolve: number;
  /** How many of their in-play Pokémon have a legal evolution available. */
  evolvable_count: number;
  /** Highest HP they could put in play by evolving. */
  best_evolved_hp: number;
  /** Prizes we would give up if they KO our active. */
  our_active_prize_value: number;
  /** 1 when any projected attacker copies an attack (Night Joker et al). */
  uses_copy_attack: number;
}

export const THREAT_FIELDS: readonly (keyof Threat)[] = [
  "now",
  "after_evolve",
  "after_attach",
  "escalation",
  "kos_our_active",
  "ko_needs_evolve",
  "evolvable_count",
  "best_evolved_hp",
  "our_active_prize_value",
  "uses_copy_attack",
];

const ZERO: Threat = {
  now: 0,
  after_evolve: 0,
  after_attach: 0,
  escalation: 0,
  kos_our_active: 0,
  ko_needs_evolve: 0,
  evolvable_count: 0,
  best_evolved_hp: 0,
  our_active_prize_value: 0,
  uses_copy_attack: 0,
};

export function threatFeatureNames(prefix: string): string[] {
  return THREAT_FIELDS.map((f) => `${prefix}_${f}`);
}

/** Energy units attached to a Pokémon, as TYPES — the shape the cost solver
 *  works in. Counting them instead would credit dead energy: a Psychic on a
 *  Lightning attacker is not progress toward a Lightning cost, and reading it
 *  as progress is a bug this codebase has already fixed once, in
 *  `costProgress`. Repeating it here would systematically overstate every
 *  off-type opponent's threat. */
function unitsOn(mon: PokemonInPlay): string[] {
  return mon.attachedEnergy.flatMap((c) => energyUnits(c, mon));
}

/** Can `pool` pay `cost`? Greedy typed match, then Colorless soaks whatever
 *  is left — the same order canPayCost and costProgress use, so the
 *  projection agrees with what the engine will actually allow.
 *
 *  `wildcards` models "and they get one more attachment this turn": the type
 *  is unknown, so the honest upper bound is a unit that pays anything. */
function canPay(pool: string[], cost: readonly string[], wildcards = 0): boolean {
  const remaining = [...pool];
  let free = wildcards;
  let colorless = 0;
  for (const req of cost) {
    if (req === "Colorless") {
      colorless += 1;
      continue;
    }
    let idx = remaining.indexOf(req);
    if (idx === -1) idx = remaining.findIndex((u) => unitPaysType(u, req));
    if (idx === -1) {
      if (free > 0) free -= 1;
      else return false;
      continue;
    }
    remaining.splice(idx, 1);
  }
  return remaining.length + free >= colorless;
}

/** The best damage any Pokémon on `side` could contribute as a COPY source.
 *  Night Joker's damage is whatever it copies, so the copier is worth the
 *  best attack its own side is holding — bench included, since that is where
 *  copy sources sit by construction. */
function bestCopyableDamage(board: PlayerView["board"]): number {
  let best = 0;
  const mons = [board.active, ...board.bench].filter((m): m is PokemonInPlay => m != null);
  for (const mon of mons) {
    for (const a of mon.card.catalog?.attacks ?? []) best = Math.max(best, baseDamage(a));
  }
  return best;
}

/** Damage an attack is worth, resolving copies. */
function attackValue(card: EngineCard, attack: EngineAttack, copyPool: number): number {
  const printed = baseDamage(attack);
  if (printed > 0) return printed;
  // No printed number. If this card copies attacks, it is worth the best
  // attack on its own side — otherwise it is genuinely a status/effect attack.
  return mechanicsOf(card.name).copies_attack > 0 ? copyPool : 0;
}

/** Best damage `card` could deal from an energy `pool`, optionally granting
 *  `wildcards` further attachments. */
function bestWithEnergy(
  card: EngineCard,
  pool: string[],
  copyPool: number,
  wildcards = 0,
): number {
  let best = 0;
  for (const a of card.attacks ?? []) {
    if (!canPay(pool, a.cost ?? [], wildcards)) continue;
    best = Math.max(best, attackValue(card, a, copyPool));
  }
  return best;
}

/** Project one turn of opponent progress against our board.
 *
 *  `view` is OUR view: `view.opponent` is the threatening side, and
 *  `view.board.active` is what is being threatened. */
export function projectThreat(view: PlayerView): Threat {
  const opp = view.opponent.board;
  const oppMons = [opp.active, ...opp.bench].filter((m): m is PokemonInPlay => m != null);
  if (oppMons.length === 0) return { ...ZERO };

  const ourActive = view.board.active;
  const copyPool = bestCopyableDamage(opp);

  let now = 0;
  let afterEvolve = 0;
  let afterAttach = 0;
  let evolvable = 0;
  let bestEvolvedHp = 0;
  let usesCopy = 0;

  for (const mon of oppMons) {
    const pool = unitsOn(mon);
    // NOW: only what the engine says is actually usable — this respects
    // costs, self-locks and status, which a cost-count comparison would not.
    for (const { attack } of usableAttacks(mon)) {
      const v = attackValue(mon.card.catalog!, attack, copyPool);
      now = Math.max(now, v);
      if (v > 0 && baseDamage(attack) === 0) usesCopy = 1;
    }

    const evos = evolutionsOf(mon.card.name);
    if (evos.length > 0) evolvable += 1;
    // The evolved form inherits the energy already attached — that is the
    // rule, and it is what makes an evolution a tempo swing rather than a
    // restart.
    for (const evoName of evos) {
      const evo = legalCard(evoName);
      if (!evo) continue;
      bestEvolvedHp = Math.max(bestEvolvedHp, evo.hp ?? 0);
      const e = bestWithEnergy(evo, pool, copyPool);
      const eAttach = bestWithEnergy(evo, pool, copyPool, 1);
      if (e > afterEvolve) afterEvolve = e;
      if (eAttach > afterAttach) afterAttach = eAttach;
      if ((e > 0 || eAttach > 0) && mechanicsOf(evoName).copies_attack > 0) usesCopy = 1;
    }
    // Staying unevolved but attaching is also an option, and for a Basic
    // attacker it is often the real one.
    const stay = bestWithEnergy(mon.card.catalog!, pool, copyPool, 1);
    if (stay > afterAttach) afterAttach = stay;
  }

  // Monotonicity: each projection grants a superset of the previous one's
  // options, so a later stage can never be worth less. Without this the
  // features could disagree with each other and the model would learn the
  // inconsistency as signal.
  afterEvolve = Math.max(afterEvolve, now);
  afterAttach = Math.max(afterAttach, afterEvolve);

  const ourHp = ourActive ? remainingHp(ourActive) : 0;
  const kos = ourActive != null && afterAttach >= ourHp ? 1 : 0;
  const koNow = ourActive != null && now >= ourHp ? 1 : 0;

  return {
    now,
    after_evolve: afterEvolve,
    after_attach: afterAttach,
    escalation: afterAttach - now,
    kos_our_active: kos,
    ko_needs_evolve: kos && !koNow ? 1 : 0,
    evolvable_count: evolvable,
    best_evolved_hp: bestEvolvedHp,
    our_active_prize_value: ourActive ? prizeOf(ourActive) : 0,
    uses_copy_attack: usesCopy,
  };
}

function prizeOf(mon: PokemonInPlay): number {
  return mechanicsOf(mon.card.name).prize_value;
}

/** Threat as a flat vector in THREAT_FIELDS order. */
export function threatVector(view: PlayerView): number[] {
  const t = projectThreat(view);
  return THREAT_FIELDS.map((f) => t[f]);
}

/** Max HP helper re-exported for callers sizing a KO race. */
export { effectiveMaxHp };
