// DecisionPolicy: the seam between game rules and play skill. The driver
// asks the policy which legal move to take; smarter policies (the turn
// planner, learned policies later) slot in behind the same interface
// without touching the rules.
//
// Policies see a PlayerView — the information set a real player has (own
// hand, public boards/discards, hidden-zone counts) — never the raw
// GameState. HeuristicPolicy implements the v1 lines: develop the board,
// attach toward the best attacker, evolve when able, attack for KOs,
// retreat when trapped.

import type { PokemonInPlay } from "../types";
import {
  baseDamage,
  canPayCost,
  computeDamage,
  remainingHp,
  usableAttacks,
  type SimMove,
  type TurnContext,
} from "./moves";
import { energyProvides } from "./setup";
import { trainerSpec, type PlayTrainerMove, type TrainerSpec } from "./trainers";
import type { PlayerView } from "./view";

export interface DecisionPolicy {
  /** Pick one of the legal moves. Returning an attack or pass ends the turn. */
  chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove;
  /** Own bench index to promote after this side's active is knocked out. */
  choosePromotion(view: PlayerView): number;
}

/* ─── Heuristic v1 ──────────────────────────────────────────────── */

/** Stop spending deck on draws/searches below this (turn-start draws must
 *  keep flowing — deck-out is a loss). Mirrors the planner's reserve. */
const DECK_RESERVE = 8;

/** Best printed damage this Pokémon could ever do (its attack ceiling). */
function attackCeiling(mon: PokemonInPlay): number {
  return Math.max(0, ...(mon.card.catalog?.attacks ?? []).map(baseDamage));
}

function inPlay(board: PlayerView["board"]): PokemonInPlay[] {
  return [board.active, ...board.bench].filter((m): m is PokemonInPlay => m !== null);
}

export class HeuristicPolicy implements DecisionPolicy {
  chooseMove(view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    const active = view.board.active;
    const defender = view.opponent.board.active;
    const byKind = <K extends SimMove["kind"]>(kind: K) =>
      legal.filter((m): m is Extract<SimMove, { kind: K }> => m.kind === kind);
    const specOf = (m: SimMove): TrainerSpec | null => {
      if (m.kind !== "play_trainer") return null;
      const card = view.hand.find((c) => c.id === m.cardId);
      return card ? trainerSpec(card) : null;
    };
    const trainersBySpec = (pred: (s: TrainerSpec) => boolean) =>
      legal.filter((m): m is PlayTrainerMove => {
        const s = specOf(m);
        return s !== null && pred(s);
      });

    // 1. Evolve — Rare Candy first (skips a stage), then normal evolves,
    //    active-target preferred (it's the one taking hits).
    const candies = trainersBySpec((s) => s.effect.kind === "rare_candy");
    if (candies.length > 0) {
      return candies.find((m) => m.monId === active?.id) ?? candies[0];
    }
    const evolves = byKind("evolve");
    if (evolves.length > 0) {
      const activeEvolve = evolves.find((m) => m.targetId === active?.id);
      return activeEvolve ?? evolves[0];
    }

    // 2. Develop the bench.
    const bench = byKind("bench");
    if (bench.length > 0) return bench[0];

    // 3. Draw fuel + searches: real draw supporters and deck searches
    //    before generic cycling — all deck-reserve guarded so we never
    //    draw ourselves out while ahead.
    if (view.deckCount > DECK_RESERVE) {
      const drawSupporters = trainersBySpec((s) => s.phase === "draw");
      if (drawSupporters.length > 0 && view.hand.length <= 5) return drawSupporters[0];
      const searches = trainersBySpec((s) => s.phase === "search");
      if (searches.length > 0) return searches[0];
      const supporter = byKind("cycle_supporter");
      if (supporter.length > 0) return supporter[0];
    }

    // 3b. Boss's Orders when it converts into a knockout our active can
    //     take right now (and the standing defender can't be KO'd).
    const gusts = trainersBySpec((s) => s.effect.kind === "gust");
    if (gusts.length > 0 && active && defender) {
      const bestVs = (target: PokemonInPlay) =>
        Math.max(
          0,
          ...usableAttacks(active).map(({ attack }) => computeDamage(active, attack, target)),
        );
      if (bestVs(defender) < remainingHp(defender)) {
        const killable = gusts.find((m) => {
          const target = view.opponent.board.bench[m.oppBenchIndex ?? -1];
          return target != null && bestVs(target) >= remainingHp(target);
        });
        if (killable) return killable;
      }
    }

    // 4. Attach toward the highest-ceiling attacker that can't attack yet
    //    (the active breaks ties so it comes online sooner).
    const attaches = byKind("attach");
    if (attaches.length > 0) {
      const mons = inPlay(view.board);
      const needy = mons
        .filter((m) => usableAttacks(m).length < (m.card.catalog?.attacks.length ?? 0))
        .sort(
          (a, b) =>
            attackCeiling(b) - attackCeiling(a) ||
            (b.id === active?.id ? 1 : 0) - (a.id === active?.id ? 1 : 0),
        );
      const target = needy[0] ?? active ?? mons[0];
      if (target) {
        // Prefer an energy card whose type appears in the target's costs.
        const wanted = new Set(
          (target.card.catalog?.attacks ?? []).flatMap((a) => a.cost),
        );
        const preferred = attaches.find((m) => {
          if (m.targetId !== target.id) return false;
          const card = view.hand.find((c) => c.id === m.cardId);
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
    if (items.length > 0 && view.deckCount > DECK_RESERVE) return items[0];

    // 5. Reposition when trapped: active can't attack, a bench mon can.
    //    Switch (free) beats paying a retreat cost.
    const activeAttacks = active ? usableAttacks(active) : [];
    if (active && activeAttacks.length === 0) {
      const switches = trainersBySpec((s) => s.effect.kind === "switch_active");
      const freeSwitch = switches.find((m) => {
        const target = view.board.bench[m.benchIndex ?? -1];
        return target != null && usableAttacks(target).length > 0;
      });
      if (freeSwitch) return freeSwitch;
      const retreats = byKind("retreat");
      const ready = retreats.find(
        (m) => usableAttacks(view.board.bench[m.benchIndex]).length > 0,
      );
      if (ready) return ready;
    }

    // 6. Attack: cheapest lethal, else biggest hit.
    const attacks = byKind("attack");
    if (attacks.length > 0 && active && defender) {
      const scored = attacks.map((m) => {
        const attack = active.card.catalog!.attacks[m.attackIndex];
        const dmg = computeDamage(active, attack, defender);
        return { move: m, dmg, lethal: dmg >= remainingHp(defender), cost: attack.cost.length };
      });
      const lethals = scored.filter((s) => s.lethal).sort((a, b) => a.cost - b.cost || b.dmg - a.dmg);
      if (lethals.length > 0) return lethals[0].move;
      const best = scored.sort((a, b) => b.dmg - a.dmg)[0];
      if (best.dmg > 0) return best.move;
    }

    return { kind: "pass" };
  }

  choosePromotion(view: PlayerView): number {
    return promoteBest(view.board.bench);
  }
}

/** Most energy attached (closest to attacking), then attack ceiling, then
 *  HP. Deterministic on bench order for ties. Shared with the planner. */
export function promoteBest(bench: PokemonInPlay[]): number {
  let best = 0;
  let bestScore = -1;
  bench.forEach((mon, i) => {
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

/** Sanity check used by tests: can the mon's best attack ever be paid. */
export function hasAffordableLine(mon: PokemonInPlay): boolean {
  return (mon.card.catalog?.attacks ?? []).some((a) => canPayCost(mon, a.cost));
}
