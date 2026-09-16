import { describe, it, expect } from "vitest";

import { instantiateDeck, viewFor } from "@/lib/engine/sim";
import { buildSimInitialState } from "@/lib/engine/sim/setup";
import { mulberry32 } from "@/lib/engine/sim/rng";
import type { PokemonInPlay } from "@/lib/engine/types";
import { lookupCard } from "@/lib/engine/catalog";
import { evolutionsOf } from "@/lib/ml/format";
import { projectThreat } from "./threat";

// A deck is only needed to get a well-formed GameState; the board is then set
// up by hand so the projection is tested against an exact, readable position
// rather than whatever a shuffle produced.
const DECK = [
  "Pokémon: 12",
  "4 N's Zorua SV9 97",
  "4 N's Zoroark ex SV9 175",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Buddy-Buddy Poffin TWM 144",
  "Energy: 24",
  "24 Basic Darkness Energy SVE 7",
].join("\n");

function monOf(name: string): PokemonInPlay {
  const catalog = lookupCard(name)!;
  return {
    id: `mon-${name}`,
    card: { id: `c-${name}`, name, catalog },
    stack: [],
    attachedEnergy: [],
    attachedTools: [],
    damage: 0,
    conditions: [],
    playedThisTurn: false,
    evolvedThisTurn: false,
  } as unknown as PokemonInPlay;
}

function attach(mon: PokemonInPlay, n: number): PokemonInPlay {
  const energy = lookupCard("Basic Darkness Energy")!;
  for (let i = 0; i < n; i++) {
    mon.attachedEnergy.push({
      id: `e-${mon.id}-${i}`,
      name: "Basic Darkness Energy",
      catalog: energy,
    } as never);
  }
  return mon;
}

/** Our view of a position where the opponent holds `oppBoard`. */
function viewWith(oppActive: PokemonInPlay, oppBench: PokemonInPlay[], ourActive: PokemonInPlay) {
  const deck = instantiateDeck(DECK)!;
  const state = buildSimInitialState(deck, instantiateDeck(DECK)!, mulberry32(3), "player");
  state.turn = { number: 4, playerTurnNumber: 2, actor: "player", phase: "turn" };
  state.sides.player.active = ourActive;
  state.sides.player.bench = [];
  state.sides.opponent.active = oppActive;
  state.sides.opponent.bench = oppBench;
  return viewFor(state, "player", { retreated: false } as never);
}

describe("opponent threat projection", () => {
  it("sees the Zoroark behind the Zorua", () => {
    // The misread this module exists to fix. N's Zorua attacks for 20 and
    // looks harmless; one evolution later it is N's Zoroark ex, whose Night
    // Joker copies an attack off their own bench.
    const zorua = attach(monOf("N's Zorua"), 2);
    const bench = [monOf("Snorlax")];
    const ours = monOf("Snorlax");
    const t = projectThreat(viewWith(zorua, bench, ours));

    expect(evolutionsOf("N's Zorua")).toContain("N's Zoroark ex");
    expect(t.now).toBe(20); // Scratch, and nothing else is payable
    expect(t.after_evolve).toBeGreaterThan(t.now);
    expect(t.escalation).toBeGreaterThan(0);
    expect(t.evolvable_count).toBe(1);
    expect(t.best_evolved_hp).toBe(280);
  });

  it("prices a copy attack by what it can copy, not by its printed damage", () => {
    // Night Joker prints NO damage number. baseDamage reads it as 0, so a
    // naive projection scores the format's premier attacker as a blank —
    // exactly the failure mode that makes threat projection worth having.
    const zorua = attach(monOf("N's Zorua"), 2);
    const weakBench = [monOf("N's Zorua")];
    const strongBench = [monOf("Snorlax")];
    const ours = monOf("Snorlax");

    const weak = projectThreat(viewWith(zorua, weakBench, ours));
    const strong = projectThreat(viewWith(zorua, strongBench, ours));

    expect(strong.after_evolve).toBeGreaterThan(weak.after_evolve);
    expect(strong.uses_copy_attack).toBe(1);
  });

  it("never lets a later projection be worth less than an earlier one", () => {
    // Each stage grants a superset of the previous stage's options. If the
    // features could disagree, the model would learn the inconsistency as
    // signal rather than as the bug it is.
    const zorua = attach(monOf("N's Zorua"), 2);
    const t = projectThreat(viewWith(zorua, [monOf("Snorlax")], monOf("Snorlax")));
    expect(t.after_evolve).toBeGreaterThanOrEqual(t.now);
    expect(t.after_attach).toBeGreaterThanOrEqual(t.after_evolve);
  });

  it("flags a KO that only exists after the evolution", () => {
    // ko_needs_evolve is the actionable bit: we are safe this turn and dead
    // next one, which is when a route must spend a turn on prevention.
    const zorua = attach(monOf("N's Zorua"), 2);
    const ours = monOf("N's Zorua"); // 70 HP — survives Scratch, not a Zoroark
    const t = projectThreat(viewWith(zorua, [monOf("Snorlax")], ours));
    expect(t.now).toBeLessThan(70);
    expect(t.kos_our_active).toBe(1);
    expect(t.ko_needs_evolve).toBe(1);
  });

  it("returns an all-zero projection for an empty opponent board", () => {
    const deck = instantiateDeck(DECK)!;
    const state = buildSimInitialState(deck, instantiateDeck(DECK)!, mulberry32(5), "player");
    state.sides.opponent.active = null;
    state.sides.opponent.bench = [];
    const t = projectThreat(viewFor(state, "player", { retreated: false } as never));
    expect(t.now).toBe(0);
    expect(t.kos_our_active).toBe(0);
  });
});

describe("energy is matched by TYPE, not counted", () => {
  it("does not credit off-type energy toward a typed cost", () => {
    // The bug this codebase already fixed once, in costProgress: a Psychic on
    // a Lightning attacker is not progress toward a Lightning cost. Counting
    // units instead of matching them would overstate the threat of every
    // off-type opponent in the corpus.
    const zoruaDark = attach(monOf("N's Zorua"), 2); // Darkness — Night Joker is [D,D]
    const zoruaWrong = monOf("N's Zorua");
    const psychic = lookupCard("Basic Psychic Energy")!;
    for (let i = 0; i < 2; i++) {
      zoruaWrong.attachedEnergy.push({
        id: `p${i}`,
        name: "Basic Psychic Energy",
        catalog: psychic,
      } as never);
    }
    const bench = [monOf("Snorlax")];
    const ours = monOf("Snorlax");

    const right = projectThreat(viewWith(zoruaDark, bench, ours));
    const wrong = projectThreat(viewWith(zoruaWrong, bench, ours));

    // Same number of energy on both, but only one of them can pay [D,D].
    expect(right.after_evolve).toBeGreaterThan(wrong.after_evolve);
  });

  it("treats the extra attachment as a wildcard, since its type is unknown", () => {
    // after_attach grants one more energy of unknown type. Modelling it as a
    // wildcard is the honest upper bound; assuming it is always the right
    // type would be the same overstatement by another route, and assuming it
    // is never useful would miss real threats.
    const zorua = monOf("N's Zorua");
    const dark = lookupCard("Basic Darkness Energy")!;
    zorua.attachedEnergy.push({ id: "d0", name: "Basic Darkness Energy", catalog: dark } as never);
    const t = projectThreat(viewWith(zorua, [monOf("Snorlax")], monOf("Snorlax")));
    // One Darkness cannot pay [D,D]; one more attachment can.
    expect(t.after_attach).toBeGreaterThan(t.after_evolve);
  });
});
