// Lock-state derivation for the replay viewer.
//
// A TCG Live log never announces "Items are locked" or "the Active can't
// retreat" — those states are consequences of card text the log leaves
// implicit. The replay reducer stays a faithful log-replayer and doesn't model
// them, so we derive them here from the action stream + engine states, using a
// small catalog of which cards impose which lock and for how long.
//
// Two lock kinds, each from two possible sources:
//   • Retreat lock — the Active can't retreat. Comes from attack riders
//     ("the Defending Pokémon can't retreat during your opponent's next turn").
//     The rider list is derived from the sim engine's own effect catalog so the
//     two never drift.
//   • Item lock — a side can't play Item cards. Comes either from an opponent's
//     static ability while a locking Pokémon is in play, or from an attack that
//     locks the defender's Items for their next turn.
//
// The item-lock catalog is seeded, not exhaustive — Item lock via ability is
// uncommon in the current format, and there is no self-announcing log signal to
// discover it. Extend ITEM_LOCK_ABILITIES / ITEM_LOCK_ATTACKS as cards appear.

import { EFFECT_CARDS } from "@/lib/engine/sim/effects/cards";
import type { GameState } from "@/lib/engine";
import type { ParsedAction } from "@/lib/battle-log/types";

export interface SideLocks {
  /** This side cannot play Item cards. */
  item: boolean;
  /** This side's Active Pokémon cannot retreat. */
  retreat: boolean;
}

export interface FrameLocks {
  player: SideLocks;
  opponent: SideLocks;
}

type Side = "player" | "opponent";
const other = (s: Side): Side => (s === "player" ? "opponent" : "player");

function emptyLocks(): FrameLocks {
  return {
    player: { item: false, retreat: false },
    opponent: { item: false, retreat: false },
  };
}

/** Attack names that lock the Defender's retreat, read straight from the sim
 *  engine's effect catalog (any `attack_rider` whose ops apply the
 *  `cannot_retreat` status). Reusing it keeps this in lockstep with the
 *  engine's own card data instead of a hand-copied second list. */
function buildRetreatLockAttacks(): Set<string> {
  const names = new Set<string>();
  for (const effects of Object.values(EFFECT_CARDS)) {
    for (const eff of effects) {
      if (eff.trigger.kind !== "attack_rider") continue;
      const locks = eff.ops.some(
        (op) => op.op === "apply_status" && op.status === "cannot_retreat",
      );
      if (locks) names.add(eff.trigger.attackName);
    }
  }
  return names;
}

const RETREAT_LOCK_ATTACKS = buildRetreatLockAttacks();

/** A Pokémon whose static ability stops a side from playing Item cards while it
 *  is in play. `zone` is where it must sit for the lock to hold; `affects`
 *  says whether only the facing opponent is locked or both players are. */
interface ItemLockAbility {
  card: string;
  zone: "active" | "in_play";
  affects: "opponent" | "both";
}

/** Seeded — see the file header. */
const ITEM_LOCK_ABILITIES: ItemLockAbility[] = [
  // Vileplume's Irritating Pollen: neither player can play Item cards while it
  // is in play.
  { card: "Vileplume", zone: "in_play", affects: "both" },
];

/** Attacks that stop the Defender from playing Item cards during their next
 *  turn. Seeded — see the file header. */
const ITEM_LOCK_ATTACKS = new Set<string>([]);

function hasCardInZone(
  side: GameState["sides"]["player"],
  card: string,
  zone: "active" | "in_play",
): boolean {
  if (zone === "active") return side.active?.card.name === card;
  return [side.active, ...side.bench].some((m) => m?.card.name === card);
}

/** Retreat lock in flight for a side: which Active instance is locked and the
 *  last global turn the lock still applies. */
type RetreatLockState = { id: string; untilTurn: number } | null;

function computeLocks(
  state: GameState,
  retreat: Record<Side, RetreatLockState>,
  itemAttackUntil: Record<Side, number>,
): FrameLocks {
  const out = emptyLocks();
  for (const side of ["player", "opponent"] as Side[]) {
    const sideState = state.sides[side];

    // Retreat lock: the exact Active instance the attack hit must still be in
    // the Active spot, and we must still be within the lock window.
    const r = retreat[side];
    if (
      r &&
      sideState.active &&
      sideState.active.id === r.id &&
      state.turn.number <= r.untilTurn
    ) {
      out[side].retreat = true;
    }

    // Item lock from an attack rider (turn-scoped).
    if (state.turn.number <= itemAttackUntil[side]) out[side].item = true;

    // Item lock from a static ability. "opponent" locks come from the facing
    // side's Pokémon; "both" locks fire from either board.
    for (const ab of ITEM_LOCK_ABILITIES) {
      const foeHas = hasCardInZone(state.sides[other(side)], ab.card, ab.zone);
      const selfHas =
        ab.affects === "both" && hasCardInZone(sideState, ab.card, ab.zone);
      if (foeHas || selfHas) out[side].item = true;
    }
  }
  return out;
}

/**
 * Derive lock state for every engine snapshot. `states[i]` is the state after
 * `actions[i]`; the returned `perState[i]` is the lock state to show on that
 * frame. `initial` covers the pre-action setup frame.
 */
export function deriveLocks(
  states: GameState[],
  actions: ParsedAction[],
): { initial: FrameLocks; perState: FrameLocks[] } {
  const retreat: Record<Side, RetreatLockState> = { player: null, opponent: null };
  const itemAttackUntil: Record<Side, number> = { player: -1, opponent: -1 };

  const perState = states.map((state, i) => {
    const action = actions[i];
    if (action && action.action_type === "attack") {
      const attackerSide = action.actor;
      if (attackerSide === "player" || attackerSide === "opponent") {
        const defSide = other(attackerSide);
        const attackName = String(action.payload.attack_name ?? "");
        const defActive = state.sides[defSide].active;
        if (RETREAT_LOCK_ATTACKS.has(attackName) && defActive) {
          // "during your opponent's next turn" — the lock holds through the
          // Defender's next turn (this global turn + 1).
          retreat[defSide] = { id: defActive.id, untilTurn: state.turn.number + 1 };
        }
        if (ITEM_LOCK_ATTACKS.has(attackName)) {
          itemAttackUntil[defSide] = state.turn.number + 1;
        }
      }
    }
    return computeLocks(state, retreat, itemAttackUntil);
  });

  return { initial: emptyLocks(), perState };
}
