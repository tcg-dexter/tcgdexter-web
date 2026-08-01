// Static ability auras — abilities that change the RULES while their Pokémon
// is in play, rather than being activated as a move. Same shape as the Stadium
// passives in stadiums.ts: declared as data, read at the one rule site each
// affects. An aura with no site is not "implemented" and stays a coverage gap.
//
// Scope matters and is easy to get wrong: some auras protect only their OWN
// Pokémon (Diamond Coat), some every matching Pokémon on their side (Curly
// Wall), and some reach across to the opponent's board (Fairy Zone, Damp).

import type { GameState, PokemonInPlay } from "../types";
import { monMatches } from "./effects/match";
import type { MonFilter } from "./effects/types";

type Actor = "player" | "opponent";
const other = (a: Actor): Actor => (a === "player" ? "opponent" : "player");

interface AbilityAura {
  /** Damage the holder (or matching friends) take is reduced. */
  damageReduction?: {
    amount: number | "all";
    /** Who it protects. Omitted = the ability's own Pokémon only. */
    protects?: MonFilter;
    /** Only against attackers matching this (Crustle: opponent's ex). */
    fromAttacker?: { isEx?: boolean; hasAbility?: boolean };
  };
  /** Attacks by matching friendly Pokémon hit the Active harder. */
  damageBonus?: { amount: number; attacker: MonFilter };
  /** Matching friendly Pokémon have no Retreat Cost. */
  retreatWaiver?: MonFilter;
  /** Attack EFFECTS (not damage) are prevented on matching friendly Pokémon. */
  preventEffects?: MonFilter;
  /** Suppresses abilities across BOTH boards. `selfKo` blocks abilities whose
   *  cost is knocking themselves out (Psyduck's Damp vs Cursed Blast). */
  abilityLock?: { selfKo?: boolean };
  /** The holder can't attack unless enough matching friends are in play. */
  attackRequires?: { filter: MonFilter; n: number };
  /** Basic Energy of `basicType` attached to your Pokémon provides extra
   *  units (Meganium's Wild Growth: Grass provides GG). */
  energyProvision?: { basicType: string; units: number };
  /** Rewrites Weakness on matching OPPONENT Pokémon (Fairy Zone). */
  weaknessOverride?: { targets: MonFilter; type: string };
  /** A named attack on the holder costs less (Seasoned Skill), scaled by the
   *  prizes the opponent has taken. */
  attackDiscount?: { attackName: string; perOppPrizeTaken?: number; flat?: number };
}

const AURAS: Record<string, AbilityAura> = {
  "Mega Diancie ex::Diamond Coat": { damageReduction: { amount: 30 } },
  "Crustle::Mysterious Rock Inn": {
    damageReduction: { amount: "all", fromAttacker: { isEx: true } },
  },
  "Cornerstone Mask Ogerpon ex::Cornerstone Stance": {
    damageReduction: { amount: "all", fromAttacker: { hasAbility: true } },
  },
  // Needs a SECOND Bouffalant in play; the count guard is applied below.
  "Bouffalant::Curly Wall": {
    damageReduction: {
      amount: 60,
      protects: { side: "own", zone: "in_play", basic: true, type: "Colorless" },
    },
  },
  "Cynthia's Roserade::Cheer On to Glory": {
    damageBonus: { amount: 30, attacker: { side: "own", zone: "in_play", namePrefix: "Cynthia's " } },
  },
  "Hop's Snorlax::Extra Helpings": {
    damageBonus: { amount: 30, attacker: { side: "own", zone: "in_play", namePrefix: "Hop's " } },
  },
  "Latias ex::Skyliner": { retreatWaiver: { side: "own", zone: "in_play", basic: true } },
  "Empoleon ex::Emperor's Stance": { preventEffects: { side: "own", zone: "in_play" } },
  "Team Rocket's Articuno::Repelling Veil": {
    preventEffects: { side: "own", zone: "in_play", basic: true, namePrefix: "Team Rocket's " },
  },
  "Psyduck::Damp": { abilityLock: { selfKo: true } },
  "Team Rocket's Mewtwo ex::Power Saver": {
    attackRequires: { filter: { side: "own", zone: "in_play", namePrefix: "Team Rocket's " }, n: 4 },
  },
  "Meganium::Wild Growth": { energyProvision: { basicType: "Grass", units: 2 } },
  "Lillie's Clefairy ex::Fairy Zone": {
    weaknessOverride: { targets: { side: "opponent", zone: "in_play", type: "Dragon" }, type: "Psychic" },
  },
  "Bloodmoon Ursaluna ex::Seasoned Skill": {
    attackDiscount: { attackName: "Blood Moon", perOppPrizeTaken: 1 },
  },
};

export function isAuraModeled(cardName: string, abilityName: string): boolean {
  return `${cardName}::${abilityName}` in AURAS;
}

/** Every active aura on `side`, paired with the Pokémon providing it. */
function aurasOn(state: GameState, side: Actor): { mon: PokemonInPlay; aura: AbilityAura }[] {
  const s = state.sides[side];
  const pool = [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
  const out: { mon: PokemonInPlay; aura: AbilityAura }[] = [];
  for (const mon of pool) {
    for (const ability of mon.card.catalog?.abilities ?? []) {
      const aura = AURAS[`${mon.card.name}::${ability.name}`];
      if (!aura) continue;
      // Curly Wall explicitly needs another copy in play.
      if (mon.card.name === "Bouffalant") {
        const copies = pool.filter((m) => m.card.name === "Bouffalant").length;
        if (copies < 2) continue;
      }
      out.push({ mon, aura });
    }
  }
  return out;
}

/** Which side owns `mon`, or null when it isn't in play. */
function sideOfMon(state: GameState, mon: PokemonInPlay): Actor | null {
  for (const a of ["player", "opponent"] as Actor[]) {
    const s = state.sides[a];
    if ([s.active, ...s.bench].some((m) => m?.id === mon.id)) return a;
  }
  return null;
}

/* ─── Rule sites ────────────────────────────────────────────────── */

/** Damage reduction on `defender` from its own side's auras. Returns
 *  Infinity when an aura prevents the damage entirely. */
export function auraDamageReduction(
  defender: PokemonInPlay,
  attacker: PokemonInPlay,
  state?: GameState,
): number {
  if (!state) return 0;
  const side = sideOfMon(state, defender);
  if (!side) return 0;
  let total = 0;
  for (const { mon, aura } of aurasOn(state, side)) {
    const r = aura.damageReduction;
    if (!r) continue;
    // Unscoped auras protect only their own Pokémon.
    if (r.protects ? !monMatches(defender, r.protects) : mon.id !== defender.id) continue;
    if (r.fromAttacker?.isEx && !(attacker.card.catalog?.subtypes.includes("ex") ?? false)) continue;
    if (r.fromAttacker?.hasAbility && (attacker.card.catalog?.abilities ?? []).length === 0) continue;
    if (r.amount === "all") return Infinity;
    total += r.amount;
  }
  return total;
}

/** Extra Active-spot damage granted to `attacker` by its side's auras. */
export function auraDamageBonus(attacker: PokemonInPlay, state?: GameState): number {
  if (!state) return 0;
  const side = sideOfMon(state, attacker);
  if (!side) return 0;
  return aurasOn(state, side).reduce((n, { aura }) => {
    const b = aura.damageBonus;
    return b && monMatches(attacker, b.attacker) ? n + b.amount : n;
  }, 0);
}

/** True when an aura waives this Pokémon's Retreat Cost (Skyliner). */
export function auraWaivesRetreat(mon: PokemonInPlay, state?: GameState): boolean {
  if (!state) return false;
  const side = sideOfMon(state, mon);
  if (!side) return false;
  return aurasOn(state, side).some(
    ({ aura }) => aura.retreatWaiver && monMatches(mon, aura.retreatWaiver),
  );
}

/** True when attack EFFECTS (conditions, riders) can't touch this Pokémon. */
export function auraPreventsEffects(mon: PokemonInPlay, state?: GameState): boolean {
  if (!state) return false;
  const side = sideOfMon(state, mon);
  if (!side) return false;
  return aurasOn(state, side).some(
    ({ aura }) => aura.preventEffects && monMatches(mon, aura.preventEffects),
  );
}

/** True when a self-KO ability (Cursed Blast) is switched off by Damp —
 *  which reaches across BOTH boards. */
export function auraBlocksSelfKoAbility(state?: GameState): boolean {
  if (!state) return false;
  return (["player", "opponent"] as Actor[]).some((a) =>
    aurasOn(state, a).some(({ aura }) => aura.abilityLock?.selfKo),
  );
}

/** True when an aura forbids this Pokémon from attacking (Power Saver). */
export function auraBlocksAttack(mon: PokemonInPlay, state?: GameState): boolean {
  if (!state) return false;
  const side = sideOfMon(state, mon);
  if (!side) return false;
  const s = state.sides[side];
  const pool = [s.active, ...s.bench].filter((m): m is PokemonInPlay => m !== null);
  for (const { mon: source, aura } of aurasOn(state, side)) {
    const req = aura.attackRequires;
    if (!req || source.id !== mon.id) continue;
    if (pool.filter((m) => monMatches(m, req.filter)).length < req.n) return true;
  }
  return false;
}

/** Extra energy units a Basic Energy provides under an aura (Wild Growth).
 *  Returns the TOTAL unit count, or null when no aura applies. */
export function auraEnergyUnits(
  energyType: string,
  mon: PokemonInPlay,
  state?: GameState,
): number | null {
  if (!state) return null;
  const side = sideOfMon(state, mon);
  if (!side) return null;
  for (const { aura } of aurasOn(state, side)) {
    const e = aura.energyProvision;
    if (e && e.basicType === energyType) return e.units;
  }
  return null;
}

/** Weakness type forced onto `mon` by an OPPONENT's aura (Fairy Zone). */
export function auraWeaknessOverride(mon: PokemonInPlay, state?: GameState): string | null {
  if (!state) return null;
  const side = sideOfMon(state, mon);
  if (!side) return null;
  for (const { aura } of aurasOn(state, other(side))) {
    const w = aura.weaknessOverride;
    if (w && monMatches(mon, w.targets)) return w.type;
  }
  return null;
}

/** Colorless removed from a named attack by the holder's own aura. */
export function auraAttackDiscount(
  mon: PokemonInPlay,
  attackName: string,
  state?: GameState,
): number {
  if (!state) return 0;
  const side = sideOfMon(state, mon);
  if (!side) return 0;
  let cut = 0;
  for (const { mon: source, aura } of aurasOn(state, side)) {
    const d = aura.attackDiscount;
    if (!d || source.id !== mon.id || d.attackName !== attackName) continue;
    cut += (d.flat ?? 0) + (d.perOppPrizeTaken ?? 0) * state.prizesTaken[other(side)];
  }
  return cut;
}
