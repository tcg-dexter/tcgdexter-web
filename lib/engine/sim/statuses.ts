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

/* ─── Self-lockout attacks ──────────────────────────────────────── */

/** "During your next turn, this Pokémon can't use Mega Brave."
 *
 *  This is how the game PAYS for enormous cheap attacks, and it was not
 *  modeled at all — so Mega Lucario ex fired Mega Brave (270 damage for two
 *  Fighting Energy) every single turn and simulated at 80.6% against a real
 *  48.9%. N's Zekrom's Rampaging Thunder (250) and Riolu's Accelerating Stab
 *  are the same shape.
 *
 *  Derived from attack TEXT rather than a per-card registry on purpose: the
 *  wording is boilerplate and identical across the whole game, so one rule
 *  covers every printing — including cards nobody has authored yet — while a
 *  registry would silently miss them, which is the failure mode that produced
 *  this bug in the first place.
 *
 *  Returns `{ attackName: null }` for a whole-Pokémon lock, `{ attackName }`
 *  for a single-attack lock, or null when the attack has no lockout. */
export function attackSelfLock(
  attackName: string,
  text: string | undefined,
): { attackName: string | null } | null {
  if (!text) return null;
  // Only "during YOUR next turn" clauses lock the user; "during your
  // OPPONENT'S next turn" is a debuff on the defender and not ours to apply.
  if (!/during your next turn/i.test(text)) return null;
  if (!/this pok[eé]mon can'?t/i.test(text)) return null;
  // "can't attack" / "can't use attacks" — every attack is locked.
  if (/can'?t (attack|use attacks)/i.test(text)) return { attackName: null };
  // "can't use <Name>" — that one attack. Match the attack's own name so a
  // reworded clause naming a different attack doesn't lock the wrong one.
  const named = new RegExp(`can'?t use ${attackName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  if (named.test(text)) return { attackName };
  return null;
}

/** Apply an attack's self-lockout to its user. `turn` is the current global
 *  turn; the attacker's next turn is two away, so the lock expires after it. */
export function applyAttackSelfLock(
  mon: PokemonInPlay,
  attackName: string,
  text: string | undefined,
  turn: number,
): void {
  const lock = attackSelfLock(attackName, text);
  if (!lock) return;
  mon.statuses = mon.statuses ?? [];
  mon.statuses.push(
    lock.attackName === null
      ? { kind: "cannot_attack", untilTurn: turn + 2 }
      : { kind: "cannot_use_attack", untilTurn: turn + 2, attackName: lock.attackName },
  );
}

/** Is this specific attack locked out right now? */
export function attackLocked(
  mon: PokemonInPlay,
  attackName: string,
  state?: GameState,
): boolean {
  return active(mon, "cannot_use_attack", state).some((s) => s.attackName === attackName);
}
