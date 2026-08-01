// Turn-scoped statuses applied by attacks ("during your opponent's next turn,
// this Pokémon takes 60 less damage"). Stored on PokemonInPlay.statuses with
// an expiry turn; every rule site queries through here so the expiry rule
// lives in exactly one place.

import type { GameState, PokemonInPlay } from "../types";

type Kind = NonNullable<PokemonInPlay["statuses"]>[number]["kind"];

function active(mon: PokemonInPlay, kind: Kind, state?: GameState) {
  const turn = state?.turn.number ?? 0;
  return (mon.statuses ?? []).filter((s) => s.kind === kind && s.untilTurn >= turn);
}

export function hasStatus(mon: PokemonInPlay, kind: Kind, state?: GameState): boolean {
  return active(mon, kind, state).length > 0;
}

/** Summed amount for a numeric status (reductions, cost bumps). */
export function statusAmount(mon: PokemonInPlay, kind: Kind, state?: GameState): number {
  return active(mon, kind, state).reduce((n, s) => n + (s.amount ?? 0), 0);
}

/** Damage reduction on the DEFENDER, honouring "…from Evolution Pokémon". */
export function damageTakenReduction(
  defender: PokemonInPlay,
  attacker: PokemonInPlay,
  state?: GameState,
): number {
  const attackerIsEvolution = Boolean(attacker.card.catalog?.evolves_from);
  return active(defender, "damage_taken_reduction", state)
    .filter((s) => !s.fromEvolutionOnly || attackerIsEvolution)
    .reduce((n, s) => n + (s.amount ?? 0), 0);
}
