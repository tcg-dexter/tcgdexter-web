// Declarative Special Energy (W2-fin.6). What a Special Energy PROVIDES is a
// static rule, read at the cost-payment site (canPayCost / totalEnergyUnits)
// rather than enumerated as a move — so it lives here as data instead of in
// the ops/trigger machinery.
//
// Several of these are CONDITIONAL on what they're attached to (Ignition gives
// 3 on an Evolution; Prism gives a wildcard on a Basic), which is why the
// lookup takes the holder and the game state, not just the card.

import type { CardInstance, GameState, PokemonInPlay } from "../../types";

/** A single energy toward a cost. A concrete type ("Fire"), the unrestricted
 *  wildcard "Any", or a RESTRICTED wildcard "Any(A|B)" that pays only those
 *  types (Team Rocket's Energy: any combination of Psychic and Darkness). */
export type EnergyUnit = string;

export function restrictedAny(types: string[]): EnergyUnit {
  return `Any(${types.join("|")})`;
}

/** Does `unit` satisfy a typed cost requirement? */
export function unitPaysType(unit: EnergyUnit, req: string): boolean {
  if (unit === req || unit === "Any") return true;
  if (unit.startsWith("Any(") && unit.endsWith(")")) {
    return unit.slice(4, -1).split("|").includes(req);
  }
  return false;
}

/** Conditions gating an alternate energy output. Evaluated against the
 *  Pokémon the card is attached to (and, for prize-count conditions, state). */
export type EnergyCondition =
  | { on: "evolution" } // any Stage 1/2 (has an evolves_from)
  | { on: "stage"; stage: "Basic" | "Stage 1" | "Stage 2" }
  | { on: "pokemon_type"; type: string }
  | { on: "no_rule_box" } // no ex/V/VSTAR rule box
  | { on: "prize_lead" } // holder's side has MORE prizes left than the opponent
  | { on: "other_special_attached" }
  | { on: "all"; of: EnergyCondition[] };

export interface SpecialEnergySpec {
  /** Units provided by default. */
  units: EnergyUnit[];
  /** First matching override replaces `units` entirely. */
  overrides?: { when: EnergyCondition; units: EnergyUnit[] }[];
  /** Extra max HP granted to the holder (Growing Grass Energy). */
  hpBonus?: { amount: number; when?: EnergyCondition };
  /** Set when a NON-output rider (on-KO, damage prevention, re-attach) is not
   *  modeled. Such a card is deliberately reported as a coverage GAP even
   *  though its energy output is correct — see isSpecialEnergyModeled. */
  unmodeledRider?: string;
}

const PSYCHIC_DARK = restrictedAny(["Psychic", "Darkness"]);

export const SPECIAL_ENERGY: Record<string, SpecialEnergySpec> = {
  /* ── Wildcards ─────────────────────────────────────────────── */
  "Luminous Energy": {
    units: ["Any"],
    // "If the Pokémon has any OTHER Special Energy attached, provides Colorless."
    overrides: [{ when: { on: "other_special_attached" }, units: ["Colorless"] }],
  },
  "Legacy Energy": {
    units: ["Any"],
    unmodeledRider: "opponent takes 1 fewer Prize on KO (once per game)",
  },
  "Prism Energy": {
    units: ["Colorless"],
    overrides: [{ when: { on: "stage", stage: "Basic" }, units: ["Any"] }],
  },
  "Neo Upper Energy": {
    units: ["Colorless"],
    overrides: [{ when: { on: "stage", stage: "Stage 2" }, units: ["Any", "Any"] }],
  },
  "Reversal Energy": {
    units: ["Colorless"],
    overrides: [
      {
        when: { on: "all", of: [{ on: "evolution" }, { on: "no_rule_box" }, { on: "prize_lead" }] },
        units: ["Any", "Any", "Any"],
      },
    ],
  },

  /* ── Multi-unit ────────────────────────────────────────────── */
  "Double Turbo Energy": {
    units: ["Colorless", "Colorless"],
    unmodeledRider: "attacks do 20 less damage",
  },
  "Team Rocket's Energy": {
    // "2 in any combination of Psychic and Darkness" — a restricted wildcard,
    // so two Psychic (or two Darkness) both pay, which a plain [P, D] wouldn't.
    units: [PSYCHIC_DARK, PSYCHIC_DARK],
  },
  "Ignition Energy": {
    units: ["Colorless"],
    overrides: [{ when: { on: "evolution" }, units: ["Colorless", "Colorless", "Colorless"] }],
    unmodeledRider: "discard at end of turn",
  },

  /* ── Typed ─────────────────────────────────────────────────── */
  "Telepathic Psychic Energy": { units: ["Psychic"] },
  "Rocky Fighting Energy": {
    units: ["Fighting"],
    unmodeledRider: "prevents attack effects on the holder",
  },
  "Mist Energy": {
    units: ["Colorless"],
    unmodeledRider: "prevents attack effects on the holder",
  },
  "Growing Grass Energy": {
    units: ["Grass"],
    hpBonus: { amount: 20, when: { on: "pokemon_type", type: "Grass" } },
  },
  "Boomerang Energy": {
    units: ["Colorless"],
    unmodeledRider: "re-attaches itself after being discarded by its own attack",
  },
  "Spiky Energy": {
    units: ["Colorless"],
    unmodeledRider: "2 damage counters on the attacker when the holder is damaged",
  },
  "Gift Energy": {
    units: ["Colorless"],
    unmodeledRider: "draw up to 7 when the holder is KO'd",
  },
  "Jet Energy": { units: ["Colorless"] }, // on-attach switch: see effects/cards.ts
  "Enriching Energy": { units: ["Colorless"] }, // on-attach draw 4: see effects/cards.ts
};

/* ─── Condition evaluation ──────────────────────────────────────── */

function stageOf(mon: PokemonInPlay): "Basic" | "Stage 1" | "Stage 2" | null {
  const cat = mon.card.catalog;
  if (cat?.supertype !== "Pokémon") return null;
  if (cat.subtypes.includes("Stage 2")) return "Stage 2";
  if (cat.subtypes.includes("Stage 1")) return "Stage 1";
  return cat.evolves_from ? null : "Basic";
}

const RULE_BOX = /\b(ex|EX|V|VMAX|VSTAR)\b/;

function condHolds(
  cond: EnergyCondition,
  card: CardInstance,
  mon: PokemonInPlay,
  state: GameState | null,
): boolean {
  switch (cond.on) {
    case "evolution":
      return Boolean(mon.card.catalog?.evolves_from);
    case "stage":
      return stageOf(mon) === cond.stage;
    case "pokemon_type":
      return mon.card.catalog?.types.includes(cond.type) ?? false;
    case "no_rule_box":
      return !RULE_BOX.test(mon.card.name);
    case "prize_lead": {
      if (!state) return false;
      const side = [state.sides.player, state.sides.opponent].find((s) =>
        [s.active, ...s.bench].some((m) => m?.id === mon.id),
      );
      if (!side) return false;
      const other = side === state.sides.player ? state.sides.opponent : state.sides.player;
      return side.prizes.length > other.prizes.length;
    }
    case "other_special_attached":
      return mon.attachedEnergy.some(
        (c) => c.id !== card.id && c.catalog?.supertype === "Energy" && c.name in SPECIAL_ENERGY,
      );
    case "all":
      return cond.of.every((c) => condHolds(c, card, mon, state));
  }
}

/** Units this Special Energy provides, given its holder. Returns null when the
 *  card isn't a declared Special Energy (caller falls back to its default). */
export function specialEnergyUnits(
  card: CardInstance,
  mon: PokemonInPlay | null,
  state: GameState | null,
): EnergyUnit[] | null {
  const spec = SPECIAL_ENERGY[card.name];
  if (!spec) return null;
  if (mon) {
    for (const o of spec.overrides ?? []) {
      if (condHolds(o.when, card, mon, state)) return [...o.units];
    }
  }
  return [...spec.units];
}

/** Extra max HP the attached Special Energy grants its holder. */
export function specialEnergyHpBonus(mon: PokemonInPlay): number {
  let bonus = 0;
  for (const card of mon.attachedEnergy) {
    const spec = SPECIAL_ENERGY[card.name];
    if (!spec?.hpBonus) continue;
    if (!spec.hpBonus.when || condHolds(spec.hpBonus.when, card, mon, null)) {
      bonus += spec.hpBonus.amount;
    }
  }
  return bonus;
}

/** Effect-coverage predicate (W1). A Special Energy counts as modeled when its
 *  ENERGY OUTPUT is declared here AND it has no rider we haven't implemented —
 *  a card whose output is right but whose on-KO/prevention text is inert is
 *  still an honest gap. */
export function isSpecialEnergyModeled(name: string): boolean {
  const spec = SPECIAL_ENERGY[name];
  return spec != null && !spec.unmodeledRider;
}
