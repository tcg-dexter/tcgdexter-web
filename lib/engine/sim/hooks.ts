// Hook-driven declarative triggers: on_damaged, end_of_turn and checkup.
// Unlike the move-shaped triggers these have no move to hang picks on — they
// fire automatically from the driver at a fixed point — so they resolve with
// empty picks and `auto` choosers only.

import type { GameState, PokemonInPlay } from "../types";
import type { Rng } from "./rng";
import { applyEffect } from "./effects/runtime";
import { triggerEffect } from "./effects/cards";
import type { ResolvedTargets } from "./effects/primitives";

type Actor = "player" | "opponent";
type HookKind = "on_damaged" | "end_of_turn" | "checkup";

/** Cards that can carry a hook effect for `mon`: its own species plus every
 *  attached Energy and Tool. */
function carriers(mon: PokemonInPlay): string[] {
  return [
    mon.card.name,
    ...mon.attachedEnergy.map((c) => c.name),
    ...mon.attachedTools.map((c) => c.name),
  ];
}

function fireFor(
  state: GameState,
  owner: Actor,
  mon: PokemonInPlay,
  kind: HookKind,
  rng: Rng | null,
  extraRefs: ResolvedTargets = {},
): void {
  for (const name of carriers(mon)) {
    const hit = triggerEffect(name, kind as "on_play");
    if (!hit) continue;
    applyEffect(
      state,
      owner,
      hit.effect,
      { kind: "effect", sourceId: mon.id, card: name, effectIndex: hit.index, picks: [] },
      rng,
      mon,
      extraRefs,
    );
  }
}

/** Fired after an attack damages `defender`. Runs for the DEFENDER's side, so
 *  its own draw/counter effects resolve for its controller — and it fires even
 *  when the defender was knocked out, per the printed wording. */
export function fireOnDamaged(
  state: GameState,
  defenderSide: Actor,
  defender: PokemonInPlay,
  attacker: PokemonInPlay,
  rng: Rng | null,
): void {
  fireFor(state, defenderSide, defender, "on_damaged", rng, {
    attacker: { mons: [{ mon: attacker, side: defenderSide === "player" ? "opponent" : "player" }], cards: [] },
  });
}

/** Fired at the end of `actor`'s turn, for that player's own Pokémon. */
export function fireEndOfTurn(state: GameState, actor: Actor, rng: Rng | null): void {
  const s = state.sides[actor];
  for (const mon of [s.active, ...s.bench]) {
    if (mon) fireFor(state, actor, mon, "end_of_turn", rng);
  }
}

/** Fired during Pokémon Checkup, for both sides. */
export function fireCheckup(state: GameState, rng: Rng | null): void {
  for (const actor of ["player", "opponent"] as Actor[]) {
    const s = state.sides[actor];
    for (const mon of [s.active, ...s.bench]) {
      if (mon) fireFor(state, actor, mon, "checkup", rng);
    }
  }
}
