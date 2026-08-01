// Copy-an-attack donor selection (Night Joker, Gemstone Mimicry, Seek
// Inspiration).
//
// Its own module because BOTH sides of the engine need it and they cannot
// import each other: `primitives.ts` resolves the copy when the attack is
// applied, while `attacks.ts` / `policy.ts` must ESTIMATE its damage before
// the attack is chosen (attacks -> primitives -> policy -> attacks is a
// cycle). Same rule that produced effects/match.ts and effects/guards.ts.
//
// Why estimation matters: N's Zoroark ex's whole archetype is copying a
// benched N's Pokémon's attack, and Night Joker prints no damage. Without an
// estimate the AI reads its ceiling as 0, never attaches energy to it, and
// the deck simulates at 17.7% against a real 53.6%.
//
// Takes a plain donor POOL rather than GameState so the policies — which see
// only a PlayerView — can call it with the same semantics the apply path uses.

import type { PokemonInPlay } from "../../types";
import { attackSelfLock } from "../statuses";
import { monMatches } from "./match";
import type { MonFilter } from "./types";

export interface CopyCandidate {
  donor: PokemonInPlay;
  attackIndex: number;
  /** Printed damage, 0 for attacks whose damage lives in their own rider. */
  damage: number;
  /** Damage per TURN, discounting an attack that locks the copier out next
   *  turn. This is what candidates are ranked by. */
  tempo: number;
}

/** A copied attack that is itself a copy would recurse; the copyDepth guard in
 *  primitives already blocks it, and we skip such donors here too so the
 *  estimate matches what apply will actually do. */
function isCopyAttack(text: string | undefined): boolean {
  return /use it as this attack/i.test(text ?? "");
}

/** Every (donor, attack) pair available from `pool`, hardest-hitting first.
 *
 *  The real card lets the player choose the Pokémon AND the attack. The first
 *  implementation took `bench.find(...)` and `attacks[0]`, which meant N's
 *  Zoroark could only ever copy N's Zekrom's Shred (70) and never its
 *  Rampaging Thunder (250) — the archetype's actual payoff was unreachable.
 *  Note the COST is paid by the copier, not the donor, so an expensive donor
 *  attack is exactly the point: no cost filtering here. */
export function copyCandidates(
  pool: readonly (PokemonInPlay | null)[],
  filter?: MonFilter,
): CopyCandidate[] {
  const out: CopyCandidate[] = [];
  for (const donor of pool) {
    if (!donor) continue;
    if (filter && !monMatches(donor, filter)) continue;
    const attacks = donor.card.catalog?.attacks ?? [];
    attacks.forEach((attack, attackIndex) => {
      if (isCopyAttack(attack.text)) return;
      const parsed = parseInt(attack.damage, 10);
      const damage = Number.isFinite(parsed) ? parsed : 0;
      // Copying an attack brings its DRAWBACK along, so raw damage is the
      // wrong thing to maximise. N's Zoroark copying Rampaging Thunder hits
      // for 250 and then cannot attack at all next turn — 125 a turn, with a
      // 280 HP body standing there defenceless in between. A 90 with no
      // lockout beats that. Rank by damage per turn.
      const locked = attackSelfLock(attack.name, attack.text) !== null;
      out.push({ donor, attackIndex, damage, tempo: locked ? damage / 2 : damage });
    });
  }
  return out.sort((a, b) => b.tempo - a.tempo || b.damage - a.damage);
}

/** Highest-damage copy available from `pool`, or null. */
export function bestCopy(
  pool: readonly (PokemonInPlay | null)[],
  filter?: MonFilter,
): CopyCandidate | null {
  return copyCandidates(pool, filter)[0] ?? null;
}

/** Slowking's Seek Inspiration copies the top deck card, which can't be known
 *  before it's revealed. A typical no-rule-box basic hits for about this much;
 *  without SOME number the AI reads the attack as worthless and never arms it. */
export const DECK_TOP_NOMINAL = 60;
