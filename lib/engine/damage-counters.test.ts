import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./index";
import type { GameState, PokemonInPlay } from "./types";

/**
 * Effect-driven damage counters — Froslass's Freezing Shroud during Pokémon
 * Checkup, and Munkidori's Adrena-Brain.
 *
 * Both were dropped entirely before parser version 2: the ability's child
 * lines were swallowed by the parent block, produced no action, and never
 * reached the engine — so the board simply never showed the damage, and
 * nothing appeared in `unmatched` to say so.
 *
 * The hard part is not the regexes, it is ownership. TCG Live stamps every
 * line of one of these groups with a single handle, the opponent's Pokémon
 * included, and the leading actor handle flips between checkups for the same
 * Froslass. So the only trustworthy field is the name, and names collide
 * across boards constantly — both players here run Munkidori.
 */
const LOG = `Setup
a11father chose tails for the opening coin flip.
Qjiaaap won the coin toss.
Qjiaaap decided to go first.
a11father drew 7 cards for the opening hand.
Qjiaaap drew 7 cards for the opening hand.
a11father played (sv9_97) N's Zorua to the Active Spot.
a11father played (sv6_95) Munkidori to the Bench.
Qjiaaap played (sv6_95) Munkidori to the Active Spot.
Qjiaaap played (me2-5_46) Snorunt to the Bench.

Qjiaaap's Turn
Qjiaaap drew a card.
Qjiaaap evolved (me2-5_46) Snorunt to (sv6_53) Froslass on the Bench.
Qjiaaap ended their turn.

Pokémon Checkup
Qjiaaap's (sv6_53) Froslass used Freezing Shroud.
- Qjiaaap put a damage counter on Qjiaaap's (sv6_95) Munkidori.
- Qjiaaap put a damage counter on Qjiaaap's (sv6_95) Munkidori.
- Qjiaaap put a damage counter on Qjiaaap's (sv9_97) N's Zorua.

a11father's Turn
a11father's (sv6_95) Munkidori used Adrena-Brain.
- a11father moved 1 damage counters from a11father's (sv6_95) Munkidori to a11father's (sv6_95) Munkidori.
a11father ended their turn.`;

const result = replay(normalizePerspective(parseBattleLog(LOG), "a11father"));

function damageOf(state: GameState, side: "player" | "opponent", name: string): number[] {
  const s = state.sides[side];
  return [s.active, ...s.bench]
    .filter((p): p is PokemonInPlay => p != null && p.card.name === name)
    .map((p) => p.damage);
}

describe("Freezing Shroud", () => {
  it("produces one action for the whole activation, not one per line", () => {
    // The board should read this as a single effect settling over it, not as
    // three unrelated events in a row — and the replay hangs a single beat
    // off it for the same reason.
    const placed = result.events.filter((e) => e.kind === "damage_counters_placed");
    expect(placed).toHaveLength(1);
    expect((placed[0].detail.targets as string[]).length).toBe(3);
  });

  it("splits identically named Pokémon across the two boards", () => {
    // Every line here says "Qjiaaap's Munkidori", and one of them is not.
    // Trusting the possessive would put both counters on one card and leave
    // the other untouched.
    const applied = result.events.find((e) => e.kind === "damage_counters_placed")!
      .detail.applied as { pokemon: string; owner: string }[];
    const munkidori = applied.filter((a) => a.pokemon === "Munkidori");
    expect(munkidori).toHaveLength(2);
    expect(new Set(munkidori.map((a) => a.owner))).toEqual(
      new Set(["player", "opponent"]),
    );
  });

  it("resolves every target it was given", () => {
    expect(
      result.diagnostics.filter((d) => d.code === "counter_target_missing"),
    ).toEqual([]);
  });
});

describe("Adrena-Brain", () => {
  it("moves damage off one Pokémon and onto another across mats", () => {
    // a11father's Munkidori took a counter from Freezing Shroud and then
    // moved it onto Qjiaaap's, which had one of its own.
    expect(damageOf(result.finalState, "player", "Munkidori")).toEqual([0]);
    expect(damageOf(result.finalState, "opponent", "Munkidori")).toEqual([20]);
  });

  it("never moves more damage than the source is carrying", () => {
    // A mis-resolved source would otherwise drive one Pokémon negative and
    // inflate the other, which reads on the board as a Pokémon healing.
    for (const side of ["player", "opponent"] as const) {
      const s = result.finalState.sides[side];
      for (const mon of [s.active, ...s.bench]) {
        if (mon) expect(mon.damage).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the checkup damage as a whole", () => {
  it("lands on the board", () => {
    // The regression in one line: before this, every Pokémon below was on 0.
    expect(damageOf(result.finalState, "player", "N's Zorua")).toEqual([10]);
    expect(
      damageOf(result.finalState, "player", "Munkidori").concat(
        damageOf(result.finalState, "opponent", "Munkidori"),
      ),
    ).toEqual([0, 20]);
  });
});
