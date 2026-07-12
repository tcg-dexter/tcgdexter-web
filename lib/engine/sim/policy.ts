// DecisionPolicy: the seam between game rules and play skill. The driver
// asks the policy which legal move to take; smarter policies (learned,
// search-based) slot in behind the same interface later without touching
// the rules. HeuristicPolicy implements the spec's v1 lines: develop the
// board, attach toward the best attacker, evolve when able, attack for
// KOs, retreat when trapped.

import type { GameState, PlayerSide, PokemonInPlay } from "../types";
import {
  baseDamage,
  canPayCost,
  computeDamage,
  remainingHp,
  sideOf,
  usableAttacks,
  type SimMove,
  type TurnContext,
} from "./moves";
import { energyProvides } from "./setup";

export interface DecisionPolicy {
  /** Pick one of the legal moves. Returning an attack or pass ends the turn. */
  chooseMove(
    state: GameState,
    actor: "player" | "opponent",
    legal: SimMove[],
    ctx: TurnContext,
  ): SimMove;
  /** Bench index to promote after the active is knocked out. */
  choosePromotion(side: PlayerSide): number;
}

/* ─── Heuristic v1 ──────────────────────────────────────────────── */

/** Best printed damage this Pokémon could ever do (its attack ceiling). */
function attackCeiling(mon: PokemonInPlay): number {
  return Math.max(0, ...(mon.card.catalog?.attacks ?? []).map(baseDamage));
}

function inPlay(side: PlayerSide): PokemonInPlay[] {
  return [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
}

export class HeuristicPolicy implements DecisionPolicy {
  chooseMove(
    state: GameState,
    actor: "player" | "opponent",
    legal: SimMove[],
    _ctx: TurnContext,
  ): SimMove {
    const side = sideOf(state, actor);
    const other = sideOf(state, actor === "player" ? "opponent" : "player");
    const byKind = <K extends SimMove["kind"]>(kind: K) =>
      legal.filter((m): m is Extract<SimMove, { kind: K }> => m.kind === kind);

    // 1. Evolve — active first (it's the one taking hits).
    const evolves = byKind("evolve");
    if (evolves.length > 0) {
      const activeEvolve = evolves.find((m) => m.targetId === side.active?.id);
      return activeEvolve ?? evolves[0];
    }

    // 2. Develop the bench.
    const bench = byKind("bench");
    if (bench.length > 0) return bench[0];

    // 3. Draw fuel: supporter first (draws more), then items.
    const supporter = byKind("cycle_supporter");
    if (supporter.length > 0) return supporter[0];

    // 4. Attach toward the highest-ceiling attacker that can't attack yet
    //    (the active breaks ties so it comes online sooner).
    const attaches = byKind("attach");
    if (attaches.length > 0) {
      const mons = inPlay(side);
      const monById = new Map(mons.map((m) => [m.id, m]));
      const needy = mons
        .filter((m) => usableAttacks(m).length < (m.card.catalog?.attacks.length ?? 0))
        .sort(
          (a, b) =>
            attackCeiling(b) - attackCeiling(a) ||
            (b.id === side.active?.id ? 1 : 0) - (a.id === side.active?.id ? 1 : 0),
        );
      const target = needy[0] ?? side.active ?? mons[0];
      if (target) {
        // Prefer an energy card whose type appears in the target's costs.
        const wanted = new Set(
          (target.card.catalog?.attacks ?? []).flatMap((a) => a.cost),
        );
        const preferred = attaches.find((m) => {
          if (m.targetId !== target.id) return false;
          const card = side.hand.find((c) => c.id === m.cardId);
          const provides = card ? energyProvides(card) : null;
          return provides !== null && wanted.has(provides);
        });
        const fallback = attaches.find((m) => m.targetId === target.id);
        const chosen = preferred ?? fallback;
        if (chosen) return chosen;
      }
      return attaches[0];
    }

    const items = byKind("cycle_item");
    if (items.length > 0) return items[0];

    // 5. Retreat when trapped: active can't attack, a bench mon can.
    const retreats = byKind("retreat");
    const activeAttacks = side.active ? usableAttacks(side.active) : [];
    if (retreats.length > 0 && side.active && activeAttacks.length === 0) {
      const ready = retreats.find((m) => usableAttacks(side.bench[m.benchIndex]).length > 0);
      if (ready) return ready;
    }

    // 6. Attack: cheapest lethal, else biggest hit.
    const attacks = byKind("attack");
    if (attacks.length > 0 && side.active && other.active) {
      const defender = other.active;
      const scored = attacks.map((m) => {
        const attack = side.active!.card.catalog!.attacks[m.attackIndex];
        const dmg = computeDamage(side.active!, attack, defender);
        return { move: m, dmg, lethal: dmg >= remainingHp(defender), cost: attack.cost.length };
      });
      const lethals = scored.filter((s) => s.lethal).sort((a, b) => a.cost - b.cost || b.dmg - a.dmg);
      if (lethals.length > 0) return lethals[0].move;
      const best = scored.sort((a, b) => b.dmg - a.dmg)[0];
      if (best.dmg > 0) return best.move;
    }

    return { kind: "pass" };
  }

  choosePromotion(side: PlayerSide): number {
    // Most energy attached (closest to attacking), then attack ceiling,
    // then HP. Deterministic on bench order for ties.
    let best = 0;
    let bestScore = -1;
    side.bench.forEach((mon, i) => {
      const score =
        mon.attachedEnergy.length * 10000 +
        attackCeiling(mon) * 10 +
        (mon.card.catalog?.hp ?? 0) / 100;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }
}

/** Sanity check used by tests: can the mon's best attack ever be paid. */
export function hasAffordableLine(mon: PokemonInPlay): boolean {
  return (mon.card.catalog?.attacks ?? []).some((a) => canPayCost(mon, a.cost));
}
