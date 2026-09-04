import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "./index";
import { replay } from "@/lib/engine";

/**
 * Pokémon fetched from the deck straight onto the Bench — Buddy-Buddy Poffin,
 * a Telepathic Psychic Energy trigger.
 *
 * TCG Live writes these as a summary dash with the names on the bullet
 * underneath:
 *
 *   a11father played Buddy-Buddy Poffin.
 *   - a11father drew 2 cards and played them to the Bench.
 *      • N's Zorua, Budew
 *
 * The parser used to drop the whole thing, and the damage surfaced much later
 * looking like a different bug entirely: with the Pokémon never benched, a
 * later promotion hit switch_active's conjure path and the card appeared in
 * the Active Spot having never been seen anywhere — no hand, no bench. This
 * is also what left the knocked-out Staryu in example-1 untrackable.
 */
const LOG = `Setup
a11father chose heads for the opening coin flip.
a11father won the coin toss.
a11father decided to go first.
a11father drew 7 cards for the opening hand.
bradfordcp drew 7 cards for the opening hand.
a11father played (sv9_26) N's Darumaka to the Active Spot.
bradfordcp played (sv9_120) Dunsparce to the Active Spot.

a11father's Turn
a11father drew (sv5_144) Buddy-Buddy Poffin.
a11father played (sv5_144) Buddy-Buddy Poffin.
- a11father drew 2 cards and played them to the Bench.
   • (sv9_97) N's Zorua, (me2-5_221) Budew
- a11father shuffled their deck.
a11father retreated (sv9_26) N's Darumaka to the Bench.
a11father's (me2-5_221) Budew is now in the Active Spot.
a11father ended their turn.

bradfordcp's Turn
bradfordcp attached (me3_88) Telepathic Psychic Energy to (sv9_120) Dunsparce in the Active Spot.
(me3_88) Telepathic Psychic Energy was activated.
- bradfordcp drew (me1_54) Abra and played it to the Bench.
- bradfordcp shuffled their deck.
bradfordcp ended their turn.`;

const parsed = parseBattleLog(LOG);
const result = replay(normalizePerspective(parsed, "a11father"));

describe("bench fetches become real actions", () => {
  it("splits a multi-card fetch into one placement per named card", () => {
    const bench = parsed.actions
      .filter((a) => a.action_type === "play_to_bench")
      .map((a) => a.payload.card);
    expect(bench).toEqual(["N's Zorua", "Budew", "Abra"]);
  });

  it("pairs the names with their own dash, not a later one", () => {
    // Bullets carry no marker saying which dash owns them, so the pairing is
    // document order alone — and the shuffle dash directly underneath has to
    // close the run, or an unrelated later list gets benched too.
    expect(
      parsed.actions.filter((a) => a.action_type === "play_to_bench"),
    ).toHaveLength(3);
  });
});

describe("the board can account for every card", () => {
  it("puts a fetched Pokémon on the bench before it is ever promoted", () => {
    const player = result.finalState.sides.player;
    expect(player.active?.card.name).toBe("Budew");
    expect(player.bench.map((b) => b.card.name).sort()).toEqual([
      "N's Darumaka",
      "N's Zorua",
    ]);
  });

  it("never has to conjure a Pokémon into the Active Spot", () => {
    // The symptom the viewer actually sees. switch_active materialises a
    // Pokémon it can't find rather than leaving the slot empty, which is the
    // right call for the board's integrity but means an untracked card simply
    // appears — no origin, no explanation.
    expect(
      result.diagnostics.filter((d) => d.code === "switch_target_missing"),
    ).toEqual([]);
  });
});
