// Damage model. All damage on a Pokémon is stored in one place —
// PokemonInPlay.damage, in HP. "Damage counters" are just that value in
// units of 10 (a counter = 10 HP), so nothing new is stored; the subtle
// distinction the rules draw is in HOW MUCH is applied:
//
//   * Attack damage to the ACTIVE applies Weakness (×2) and Resistance
//     (−30). See computeDamage in moves.ts.
//   * Damage to a BENCHED Pokémon never applies Weakness/Resistance
//     (core rule; e.g. N's Darmanitan's Flamebody Cannon says so).
//   * Placing damage COUNTERS never applies Weakness/Resistance, whatever
//     the target (Dragapult, Munkidori, Dusknoir, Gardevoir).
//
// KO resolution is bench-aware: any Pokémon whose damage reaches its HP is
// Knocked Out — not just the defending active — and the player who owns
// the OPPOSING side takes its Prize cards.

import type { GameState, PlayerSide, PokemonInPlay } from "../types";
import { stadiumPreventsBenchCounters } from "./stadiums";
import { prizeValue } from "./setup";
import { effectiveMaxHp } from "./tools";

// Local (avoids a driver ↔ damage import cycle).
const opposite = (actor: "player" | "opponent"): "player" | "opponent" =>
  actor === "player" ? "opponent" : "player";

/** Max HP including Pokémon Tool bonuses (Bravery Charm, Binding Mochi). */
export function maxHp(mon: PokemonInPlay): number {
  return effectiveMaxHp(mon);
}

export function isKnockedOut(mon: PokemonInPlay): boolean {
  return mon.damage >= maxHp(mon);
}

/** Raw damage to a specific Pokémon, no Weakness/Resistance. Used for
 *  bench damage and self-damage; the active-attack path applies W/R in
 *  computeDamage before adding to mon.damage directly. */
export function dealRawDamage(mon: PokemonInPlay, amount: number): void {
  if (amount > 0) mon.damage += amount;
}

/** Place N damage counters (10 HP each) — never modified by W/R. */
export function placeCounters(mon: PokemonInPlay, counters: number): void {
  if (counters > 0) mon.damage += counters * 10;
}

/** Heal N damage counters (10 HP each), floored at 0. */
export function healCounters(mon: PokemonInPlay, counters: number): void {
  mon.damage = Math.max(0, mon.damage - counters * 10);
}

/** Move up to `counters` damage counters from `from` to `to`. Bounded by
 *  what `from` actually carries (Munkidori). Returns how many moved. */
export function moveCounters(from: PokemonInPlay, to: PokemonInPlay, counters: number): number {
  const available = Math.floor(from.damage / 10);
  const moved = Math.max(0, Math.min(counters, available));
  from.damage -= moved * 10;
  to.damage += moved * 10;
  return moved;
}

/* ─── Bench allocation (attack placement effects) ───────────────── */

const HP_TO_KO = (mon: PokemonInPlay) => maxHp(mon) - mon.damage;

/** Place `counters` damage counters on a side's Bench. Uses the player's
 *  chosen allocation (`chosenIds`, one entry per counter) when it's a valid
 *  bench selection; otherwise auto-allocates to maximize knockouts — fill
 *  the closest-to-KO Pokémon first, then spread. */
/** Battle Cage: counters can't be PLACED on the Bench by attack/ability
 *  effects. Raw bench DAMAGE (placeBenchDamage) is unaffected. */
export function placeAttackCounters(
  side: PlayerSide,
  counters: number,
  chosenIds?: string[],
  state?: GameState,
): void {
  // Battle Cage: counters can't be PLACED on the Bench by attack/ability
  // effects at all. (Raw bench DAMAGE — placeBenchDamage — still applies.)
  if (stadiumPreventsBenchCounters(state)) return;
  if (side.bench.length === 0) return; // no legal target — counters fizzle
  if (chosenIds && chosenIds.length === counters) {
    const valid = chosenIds.every((id) => side.bench.some((m) => m.id === id));
    if (valid) {
      for (const id of chosenIds) {
        const mon = side.bench.find((m) => m.id === id);
        if (mon) placeCounters(mon, 1);
      }
      return;
    }
  }
  // Auto: greedily finish the Pokémon needing the fewest counters.
  let remaining = counters;
  const bench = [...side.bench].sort((a, b) => HP_TO_KO(a) - HP_TO_KO(b));
  for (const mon of bench) {
    if (remaining <= 0) break;
    const need = Math.ceil(HP_TO_KO(mon) / 10);
    const put = Math.min(need, remaining);
    placeCounters(mon, put);
    remaining -= put;
  }
  // Any leftover after every bench mon would be KO'd: pile onto the first.
  if (remaining > 0) placeCounters(bench[0], remaining);
}

/** Deal `amount` raw damage to `targets` Benched Pokémon (no W/R). Uses the
 *  player's chosen targets, else the benched Pokémon this would KO (or the
 *  highest-HP threat). */
export function placeBenchDamage(
  side: PlayerSide,
  amount: number,
  targets: number,
  chosenIds?: string[],
): void {
  if (side.bench.length === 0) return;
  let picks: PokemonInPlay[];
  if (chosenIds && chosenIds.length > 0) {
    picks = chosenIds
      .map((id) => side.bench.find((m) => m.id === id))
      .filter((m): m is PokemonInPlay => m != null)
      .slice(0, targets);
  } else {
    const sorted = [...side.bench].sort((a, b) => {
      const aKo = amount >= HP_TO_KO(a) ? 1 : 0;
      const bKo = amount >= HP_TO_KO(b) ? 1 : 0;
      return bKo - aKo || maxHp(b) - maxHp(a); // KO first, then biggest threat
    });
    picks = sorted.slice(0, targets);
  }
  for (const mon of picks) dealRawDamage(mon, amount);
}

export interface KnockoutResult {
  /** Sides whose active was KO'd and now need a replacement promoted. */
  pendingPromotions: ("player" | "opponent")[];
  /** Set when a player has won (6 prizes, or opponent has no Pokémon). */
  winner: "player" | "opponent" | null;
  endReason: "prizes" | "no_active" | null;
  /** Global turn of the first KO this pass produced (for stats). */
  koTurn: number | null;
}

/** Prize reduction granted by cards attached to a fallen Pokémon. Lillie's
 *  Pearl needs a Lillie's Pokémon; Legacy Energy applies once per game. */
function prizeShieldFor(mon: PokemonInPlay, side: PlayerSide): number {
  let n = 0;
  const hasPearl = mon.attachedTools.some((t) => t.name === "Lillie's Pearl");
  if (hasPearl && mon.card.name.startsWith("Lillie's ")) n += 1;
  const hasLegacy = mon.attachedEnergy.some((c) => c.name === "Legacy Energy");
  if (hasLegacy && (side.prizeShieldOnce ?? 0) === 0) n += 1;
  return n;
}

function knockOut(state: GameState, side: PlayerSide, mon: PokemonInPlay, ownerActor: "player" | "opponent"): void {
  side.discard.push(mon.card, ...mon.stack, ...mon.attachedEnergy, ...mon.attachedTools);
  if (side.active === mon) {
    side.active = null;
  } else {
    const idx = side.bench.indexOf(mon);
    if (idx >= 0) side.bench.splice(idx, 1);
  }
  // Record a comeback trigger: this side lost a Pokémon during the
  // opponent's turn (not its own turn / system checkup). Read next turn by
  // Fezandipiti ex's Flip the Script; cleared at the opponent's next turn.
  if (state.turn.actor === opposite(ownerActor)) {
    side.koedLastOppTurn = true;
  }
  // The player facing this side takes the Prize cards — unless a prize
  // shield attached to the fallen Pokémon reduces the count (Lillie's Pearl,
  // Legacy Energy). Shields are consumed, matching "can't be applied more
  // than once per game".
  const taker = opposite(ownerActor);
  let count = prizeValue(mon.card.name);
  const shield = prizeShieldFor(mon, side);
  if (shield > 0) {
    count = Math.max(0, count - shield);
    side.prizeShieldOnce = (side.prizeShieldOnce ?? 0) + shield; // consumed
  }
  const taken = state.sides[taker].prizes.splice(0, count);
  state.sides[taker].hand.push(...taken);
  state.prizesTaken[taker] += taken.length;
  const takerSide = state.sides[taker];
  takerSide.prizesTakenThisTurn = (takerSide.prizesTakenThisTurn ?? 0) + taken.length;
}

/**
 * Scan both sides, Knock Out every Pokémon at or over its HP, award Prizes,
 * and report who must promote / whether the game ended. Idempotent to call
 * after any damage-dealing move.
 */
export function resolveKnockouts(state: GameState): KnockoutResult {
  const result: KnockoutResult = {
    pendingPromotions: [],
    winner: null,
    endReason: null,
    koTurn: null,
  };
  let anyKo = false;

  for (const actor of ["player", "opponent"] as const) {
    const side = state.sides[actor];
    const dying = [side.active, ...side.bench].filter(
      (m): m is PokemonInPlay => m !== null && isKnockedOut(m),
    );
    for (const mon of dying) {
      const wasActive = side.active === mon;
      knockOut(state, side, mon, actor);
      anyKo = true;
      if (wasActive && side.bench.length > 0) result.pendingPromotions.push(actor);
    }
  }
  if (anyKo) result.koTurn = state.turn.number;

  // Win checks: prizes first (simultaneous KOs still resolve as a win for
  // whoever crossed 6), then no-Pokémon.
  if (state.prizesTaken.player >= 6 && state.prizesTaken.opponent < 6) {
    result.winner = "player";
    result.endReason = "prizes";
  } else if (state.prizesTaken.opponent >= 6 && state.prizesTaken.player < 6) {
    result.winner = "opponent";
    result.endReason = "prizes";
  } else if (state.prizesTaken.player >= 6 && state.prizesTaken.opponent >= 6) {
    // Both hit 6 the same pass — the turn player (who dealt the damage) wins.
    result.winner = state.turn.actor === "opponent" ? "opponent" : "player";
    result.endReason = "prizes";
  } else {
    for (const actor of ["player", "opponent"] as const) {
      const side = state.sides[actor];
      if (!side.active && side.bench.length === 0) {
        result.winner = opposite(actor);
        result.endReason = "no_active";
      }
    }
  }
  // A side that must promote but the game already ended: drop it.
  if (result.winner) result.pendingPromotions = [];
  return result;
}
