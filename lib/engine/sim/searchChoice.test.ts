import { describe, expect, it } from "vitest";
import { bestEffectPick, searchTargetValue } from "./policy";
import type { EffectMove } from "./effects/runtime";
import type { PlayerView } from "./view";

function view(inPlay: string[]): PlayerView {
  const mon = (name: string) => ({ id: name, card: { id: name, name }, attachedEnergy: [] });
  return {
    board: { active: inPlay[0] ? mon(inPlay[0]) : null, bench: inPlay.slice(1).map(mon) },
    opponent: { board: { active: null, bench: [] } },
    hand: [],
    deckCount: 40,
  } as unknown as PlayerView;
}

function move(names: string[]): EffectMove {
  return {
    kind: "effect",
    sourceId: "s",
    card: "Ultra Ball",
    effectIndex: 0,
    picks: [{ ref: "t", cardIds: names.map((_, i) => `c${i}`), cardNames: names }],
  };
}

describe("search target choice", () => {
  it("prefers the card that completes an evolution line already in play", () => {
    // The regression this guards: both policies took the FIRST enumerated
    // option, so a search fetched whatever the enumerator happened to list
    // first rather than the piece the board actually needs.
    const v = view(["N's Zorua"]);
    const chosen = bestEffectPick(v, [move(["Budew"]), move(["N's Zoroark ex"])]);
    expect(chosen.picks[0].cardNames).toEqual(["N's Zoroark ex"]);
  });

  it("prefers the harder hitter when nothing evolves", () => {
    const v = view(["Pikachu"]);
    const chosen = bestEffectPick(v, [move(["Budew"]), move(["N's Zekrom"])]);
    expect(chosen.picks[0].cardNames).toEqual(["N's Zekrom"]);
  });

  it("never prefers finding nothing over a real hit", () => {
    // Multi-slot searches may legally fail to find, and an empty pick set
    // must not win by scoring 0 against a negative baseline.
    const v = view(["Pikachu"]);
    const chosen = bestEffectPick(v, [move([]), move(["N's Zekrom"])]);
    expect(chosen.picks[0].cardNames).toEqual(["N's Zekrom"]);
  });

  it("scores an in-play evolution above raw damage", () => {
    const inPlay = new Set(["N's Zorua"]);
    expect(searchTargetValue("N's Zoroark ex", inPlay)).toBeGreaterThan(
      searchTargetValue("N's Zekrom", inPlay),
    );
  });
});
