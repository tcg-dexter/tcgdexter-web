import { describe, expect, it } from "vitest";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./index";

/**
 * Special Conditions come off when a Pokémon leaves the Active Spot.
 *
 * The retreat handler cleared them itself, which covered the obvious case and
 * hid every other one. A promotion after a knockout, a Boss's Orders, a
 * Pecharunt's Subjugating Chains — all move the Active out with no retreat
 * action anywhere in the log, and the outgoing Pokémon carried its badge onto
 * the bench and kept it for the rest of the game.
 */
const LOG = `Setup
a11father chose heads for the opening coin flip.
a11father won the coin toss.
a11father decided to go first.
a11father drew 7 cards for the opening hand.
FenrisDWolf drew 7 cards for the opening hand.
a11father played (sv9_175) N's Zoroark ex to the Active Spot.
a11father played (sv9_97) N's Zorua to the Bench.
FenrisDWolf played (me1_77) Mega Lucario ex to the Active Spot.

a11father's Turn
a11father drew a card.
a11father's (sv6-5_39) Pecharunt ex used Subjugating Chains.
- a11father's (sv9_175) N's Zoroark ex is now Poisoned.
a11father ended their turn.

FenrisDWolf's Turn
FenrisDWolf drew a card.
FenrisDWolf ended their turn.

a11father's Turn
a11father drew a card.
a11father's (sv9_97) N's Zorua is now in the Active Spot.
a11father ended their turn.`;

const result = replay(normalizePerspective(parseBattleLog(LOG), "a11father"));

describe("leaving the Active Spot", () => {
  it("strips conditions from a Pokémon promoted away without a retreat", () => {
    // The exact sequence from the reported match: the log announces the
    // incoming Pokémon only ("N's Zorua is now in the Active Spot"), with no
    // retreat line to hang the cleanup off.
    const side = result.finalState.sides.player;
    expect(side.active?.card.name).toBe("N's Zorua");
    const zoroark = side.bench.find((p) => p.card.name === "N's Zoroark ex");
    expect(zoroark, "N's Zoroark ex should be on the bench").toBeDefined();
    expect(zoroark!.conditions).toEqual([]);
  });

  it("is not a vacuous guard — the Pokémon really was Poisoned first", () => {
    // If the condition never applied, the assertion above would pass for the
    // wrong reason and the bug could come straight back.
    const poisoned = result.events.find((e) => e.kind === "condition_applied");
    expect(poisoned?.detail).toMatchObject({
      pokemon: "N's Zoroark ex",
      condition: "Poisoned",
    });
  });

  it("leaves the incoming Active clean too", () => {
    expect(result.finalState.sides.player.active?.conditions).toEqual([]);
  });
});
