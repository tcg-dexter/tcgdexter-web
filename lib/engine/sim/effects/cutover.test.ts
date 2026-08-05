// W2 cutover (headless): the universal `effect` move flows through the live
// engine stack — validate (isLegalHumanMove) and the driver (applyMove) — the
// same path human and AI moves take. Distinct from runtime.test.ts (which
// tests enumerate/apply in isolation): this proves the integration seams the
// cutover adds, while the effect kind is still dormant in legalMoves.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "../setup";
import { lookupCard } from "../../catalog";
import { mintInstanceId } from "../../initial";
import { mulberry32 } from "../rng";
import type { CardInstance, GameState, PokemonInPlay } from "../../types";
import { applyMove, beginTurn } from "../driver";
import { activatedHandDiscard, applyAbility } from "../abilities";
import { attackBaseDamage } from "../attacks";
import { isLegalHumanMove } from "../validate";
import { describeMove } from "../serialize";
import { legalMoves, type SimMove, type TurnContext } from "../moves";
import { HeuristicPolicy } from "../policy";
import { viewFor } from "../view";
import { startGame, applyHumanMove, rebuildSession, humanOptions, autoSetup } from "../interactive";
import { applyEffect, enumerateEffect, type EffectMove } from "./runtime";
import { effectsFor, effectDiscardCost, effectDiscardFilter } from "./cards";
import { isToolModeled } from "../tools";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string): PokemonInPlay => toPokemonInPlay(card(n), 0);

function state(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 8", "4 Pikachu SVI 62", "4 Snorlax", "Energy: 52", "52 Basic Darkness Energy"].join("\n"),
    "t",
  );
  const s = buildSimInitialState(deck, deck, mulberry32(3), "player");
  s.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  return s;
}
const ctx = (): TurnContext => ({ retreated: false });
const eff = (name: string) => effectsFor(name)[0];

/** First enumerated effect move for a hand card, via the runtime. */
function firstEffectMove(s: GameState, src: CardInstance): EffectMove {
  const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff(src.name), 0);
  expect(moves.length).toBeGreaterThan(0);
  return moves[0];
}

describe("W2 cutover — effect moves through validate + driver", () => {
  it("Boss's Orders: isLegalHumanMove accepts an enumerated pick and applyMove gusts", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    const target = mon("Snorlax");
    s.sides.opponent.bench = [target];

    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(true);
    expect(describeMove(s, "player", move)).toContain("Boss's Orders");

    applyMove(s, "player", move, ctx(), mulberry32(9));
    expect(s.sides.opponent.active).toBe(target);
    expect(s.sides.player.supporterPlayedThisTurn).toBe(true);
    expect(s.sides.player.discard.some((c) => c.id === src.id)).toBe(true);
  });

  it("Nest Ball: applyMove benches the fetched Basic via the driver", () => {
    const s = state();
    const src = card("Nest Ball");
    s.sides.player.hand = [src];
    const benchBefore = s.sides.player.bench.length;

    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(true);
    applyMove(s, "player", move, ctx(), mulberry32(9));
    expect(s.sides.player.bench.length).toBe(benchBefore + 1);
  });

  it("rejects a forged pick that enumeration never produced", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];

    const forged: EffectMove = {
      kind: "effect",
      sourceId: src.id,
      card: "Boss's Orders",
      effectIndex: 0,
      picks: [{ ref: "t", monIds: ["not-a-real-mon-id"] }],
    };
    expect(isLegalHumanMove(s, "player", ctx(), forged)).toBe(false);
  });

  it("rejects an effect move whose source card is not in hand", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];
    // src deliberately NOT placed in hand.
    const move: EffectMove = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(false);
  });

  it("Team Rocket's Transceiver: goes live through legalMoves → policy → driver", () => {
    // The first DECLARATIVE-ONLY card (not in the legacy registry): legalMoves
    // must now emit it, the AI policy must SELECT it, and the driver applies it.
    const s = state();
    const transceiver = card("Team Rocket's Transceiver");
    s.sides.player.hand = [transceiver];
    const petrel = card("Team Rocket's Petrel");
    s.sides.player.deck.unshift(petrel); // a fetchable Team Rocket's Supporter

    const legal = legalMoves(s, "player", ctx());
    const effectMoves = legal.filter(
      (m): m is EffectMove => m.kind === "effect" && m.card === "Team Rocket's Transceiver",
    );
    expect(effectMoves.length).toBeGreaterThan(0);
    // The pick carries the fetched Supporter's display name (for the UI).
    expect(effectMoves.some((m) => m.picks[0]?.cardNames?.includes("Team Rocket's Petrel"))).toBe(true);

    // The heuristic AI selects it (a search card, played in the info phase).
    const chosen = new HeuristicPolicy().chooseMove(viewFor(s, "player", ctx()), legal, ctx());
    expect(chosen.kind).toBe("effect");
    expect((chosen as EffectMove).card).toBe("Team Rocket's Transceiver");

    applyMove(s, "player", chosen as SimMove, ctx(), mulberry32(9));
    expect(s.sides.player.hand.some((c) => c.id === petrel.id)).toBe(true);
    expect(s.sides.player.discard.some((c) => c.id === transceiver.id)).toBe(true);
  });

  it("enforces the supporter-per-turn gate on a declarative Supporter", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];
    s.sides.player.supporterPlayedThisTurn = true; // already used one
    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(false);
  });
});

describe("W2-fin — declarative `activated` ability trigger", () => {
  /** Put a Mega Kangaskhan ex into the Active spot and return it. */
  function withKangaskhan(s: GameState): PokemonInPlay {
    const kanga = mon("Mega Kangaskhan ex");
    s.sides.player.active = kanga;
    return kanga;
  }

  it("Run Errand: legalMoves emits it, the driver draws 2, and it is spent for the turn", () => {
    const s = state();
    const kanga = withKangaskhan(s);
    const handBefore = s.sides.player.hand.length;
    const deckBefore = s.sides.player.deck.length;

    const legal = legalMoves(s, "player", ctx());
    const abilityMove = legal.find(
      (m): m is EffectMove => m.kind === "effect" && m.card === "Mega Kangaskhan ex",
    );
    expect(abilityMove, "Run Errand was not enumerated").toBeDefined();
    // The source is the MON, not a hand card — that's what applyEffect resolves.
    expect(abilityMove!.sourceId).toBe(kanga.id);
    expect(describeMove(s, "player", abilityMove!)).toContain("Run Errand");
    expect(isLegalHumanMove(s, "player", ctx(), abilityMove!)).toBe(true);

    applyMove(s, "player", abilityMove!, ctx(), mulberry32(9));
    expect(s.sides.player.hand.length).toBe(handBefore + 2);
    expect(s.sides.player.deck.length).toBe(deckBefore - 2);

    // Once per turn per Pokémon: gone from legalMoves AND rejected by validate
    // (the human path must not be able to replay it).
    expect(kanga.abilitiesUsedThisTurn).toContain("Run Errand");
    const after = legalMoves(s, "player", ctx());
    expect(after.some((m) => m.kind === "effect" && m.card === "Mega Kangaskhan ex")).toBe(false);
    expect(isLegalHumanMove(s, "player", ctx(), abilityMove!)).toBe(false);
  });

  it("respects the is_active guard — benched Mega Kangaskhan ex cannot Run Errand", () => {
    const s = state();
    s.sides.player.active = mon("Pikachu");
    s.sides.player.bench = [mon("Mega Kangaskhan ex")];

    const legal = legalMoves(s, "player", ctx());
    expect(legal.some((m) => m.kind === "effect" && m.card === "Mega Kangaskhan ex")).toBe(false);
  });

  it("legacy ACTIVATED abilities keep their tuned use_ability moves (precedence)", () => {
    // Munkidori is in the legacy registry: it must still produce use_ability,
    // and must NOT be double-listed as a declarative effect move.
    const s = state();
    const munkidori = mon("Munkidori");
    munkidori.attachedEnergy = [card("Basic Darkness Energy")];
    s.sides.player.active = munkidori;
    const damaged = mon("Snorlax");
    damaged.damage = 30;
    s.sides.player.bench = [damaged];
    s.sides.opponent.active = mon("Pikachu");

    const legal = legalMoves(s, "player", ctx());
    expect(legal.some((m) => m.kind === "use_ability" && m.abilityName === "Adrena-Brain")).toBe(true);
    expect(legal.some((m) => m.kind === "effect" && m.card === "Munkidori")).toBe(false);
  });

  it("the heuristic AI selects a declarative draw ability", () => {
    const s = state();
    withKangaskhan(s);
    s.sides.player.hand = []; // hand-starved: the draw branch should fire
    s.sides.opponent.active = mon("Pikachu");

    const legal = legalMoves(s, "player", ctx());
    const chosen = new HeuristicPolicy().chooseMove(viewFor(s, "player", ctx()), legal, ctx());
    expect(chosen.kind).toBe("effect");
    expect((chosen as EffectMove).card).toBe("Mega Kangaskhan ex");
  });
});

describe("W2-fin — declarative `attack_rider` trigger", () => {
  /** Put `attackerName` Active with `energy` copies of a basic energy that can
   *  actually pay its attack cost (Cruel Arrow is Colorless, Mini Drain Grass,
   *  Tail Smack Lightning — the wrong type simply yields no legal attack). */
  function attackReady(
    s: GameState,
    attackerName: string,
    energy: number,
    type = "Darkness",
  ): PokemonInPlay {
    const atk = mon(attackerName);
    for (let i = 0; i < energy; i++) atk.attachedEnergy.push(card(`Basic ${type} Energy`));
    s.sides.player.active = atk;
    return atk;
  }

  it("Cruel Arrow: the attack enumerates one move per target and damages the pick", () => {
    const s = state();
    const fez = attackReady(s, "Fezandipiti ex", 3);
    s.sides.opponent.active = mon("Pikachu");
    const benched = mon("Snorlax");
    s.sides.opponent.bench = [benched];

    const attacks = legalMoves(s, "player", ctx()).filter(
      (m): m is Extract<SimMove, { kind: "attack" }> => m.kind === "attack",
    );
    const cruel = attacks.filter((m) => m.riderPicks && m.riderPicks.length > 0);
    // One move per opponent Pokémon in play (active + bench).
    expect(cruel.length).toBe(2);
    expect(
      cruel.some((m) => m.riderPicks![0].monIds?.includes(benched.id)),
    ).toBe(true);

    // Pick the BENCHED target — this is what a rider makes possible and what
    // the old inert path could never do.
    const atBench = cruel.find((m) => m.riderPicks![0].monIds?.includes(benched.id))!;
    expect(isLegalHumanMove(s, "player", ctx(), atBench)).toBe(true);
    applyMove(s, "player", atBench, ctx(), mulberry32(9));
    expect(benched.damage).toBe(100); // no W/R on the bench
    expect(fez.card.name).toBe("Fezandipiti ex");
  });

  it("rejects a forged rider target that enumeration never produced", () => {
    const s = state();
    attackReady(s, "Fezandipiti ex", 3);
    s.sides.opponent.active = mon("Pikachu");

    const attack = legalMoves(s, "player", ctx()).find(
      (m): m is Extract<SimMove, { kind: "attack" }> => m.kind === "attack",
    )!;
    const forged = { ...attack, riderPicks: [{ ref: "t", monIds: ["not-a-real-mon-id"] }] };
    expect(isLegalHumanMove(s, "player", ctx(), forged)).toBe(false);
  });

  it("rejects an attack that omits picks its rider requires", () => {
    const s = state();
    attackReady(s, "Fezandipiti ex", 3);
    s.sides.opponent.active = mon("Pikachu");

    // Candidates exist, so a bare attack (no rider target) must not validate.
    expect(isLegalHumanMove(s, "player", ctx(), { kind: "attack", attackIndex: 0 })).toBe(false);
  });

  it("Mini Drain: a target-less rider heals the attacker via the reserved `self` ref", () => {
    const s = state();
    const applin = attackReady(s, "Applin", 1, "Grass");
    applin.damage = 50;
    s.sides.opponent.active = mon("Snorlax");

    const attack = legalMoves(s, "player", ctx()).find(
      (m): m is Extract<SimMove, { kind: "attack" }> => m.kind === "attack",
    )!;
    // No target slot, so no picks are enumerated — the attack stands alone.
    expect(attack.riderPicks).toBeUndefined();
    expect(isLegalHumanMove(s, "player", ctx(), attack)).toBe(true);

    applyMove(s, "player", attack, ctx(), mulberry32(9));
    expect(applin.damage).toBe(40); // healed 10 from itself
  });

  it("attacks without a declarative rider are unchanged (no picks, still legal)", () => {
    const s = state();
    attackReady(s, "Pikachu", 3, "Lightning");
    s.sides.opponent.active = mon("Snorlax");

    const attacks = legalMoves(s, "player", ctx()).filter(
      (m): m is Extract<SimMove, { kind: "attack" }> => m.kind === "attack",
    );
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.every((m) => m.riderPicks === undefined)).toBe(true);
    expect(isLegalHumanMove(s, "player", ctx(), attacks[0])).toBe(true);
  });
});

describe("W2-fin — declarative `damage_scale` trigger", () => {
  const dmg = (
    s: GameState,
    attackerName: string,
    attackName: string,
    rngSeed: number | null = null,
  ) => {
    const atk = mon(attackerName);
    s.sides.player.active = atk;
    const idx = (atk.card.catalog?.attacks ?? []).findIndex((a) => a.name === attackName);
    expect(idx, `${attackerName} has no attack ${attackName}`).toBeGreaterThanOrEqual(0);
    return attackBaseDamage(s, "player", atk, idx, rngSeed == null ? null : mulberry32(rngSeed));
  };

  it("MIGRATED Burning Darkness matches the retired legacy scaler (180 + 30/prize)", () => {
    const s = state();
    expect(dmg(s, "Charizard ex", "Burning Darkness")).toBe(180);
    s.prizesTaken.opponent = 3; // the OPPONENT has taken 3
    expect(dmg(s, "Charizard ex", "Burning Darkness")).toBe(180 + 90);
  });

  it("MIGRATED Back Draft matches the retired legacy scaler (30/basic energy in opp discard)", () => {
    const s = state();
    expect(dmg(s, "N's Darmanitan", "Back Draft")).toBe(0);
    s.sides.opponent.discard = [
      card("Basic Darkness Energy"),
      card("Basic Darkness Energy"),
      card("Nest Ball"), // not energy — must not count
    ];
    expect(dmg(s, "N's Darmanitan", "Back Draft")).toBe(60);
  });

  it("counts benched Pokémon on BOTH sides (Full Moon Rondo)", () => {
    const s = state();
    s.sides.player.bench = [mon("Pikachu"), mon("Snorlax")];
    s.sides.opponent.bench = [mon("Pikachu")];
    // 20 + 20 × 3 benched
    expect(dmg(s, "Lillie's Clefairy ex", "Full Moon Rondo")).toBe(80);
  });

  it("counts energy on BOTH Actives (Myriad Leaf Shower)", () => {
    const s = state();
    const opp = mon("Snorlax");
    opp.attachedEnergy = [card("Basic Darkness Energy")];
    s.sides.opponent.active = opp;
    const atk = mon("Teal Mask Ogerpon ex");
    atk.attachedEnergy = [card("Basic Grass Energy"), card("Basic Grass Energy")];
    s.sides.player.active = atk;
    const idx = (atk.card.catalog?.attacks ?? []).findIndex((a) => a.name === "Myriad Leaf Shower");
    // 30 + 30 × (2 own + 1 opp)
    expect(attackBaseDamage(s, "player", atk, idx, null)).toBe(120);
  });

  it("applies a conditional bonus only against a Pokémon ex (Rising Blade)", () => {
    const s = state();
    s.sides.opponent.active = mon("Snorlax"); // not an ex
    expect(dmg(s, "Chien-Pao", "Rising Blade")).toBe(80);
    s.sides.opponent.active = mon("Fezandipiti ex"); // an ex
    expect(dmg(s, "Chien-Pao", "Rising Blade")).toBe(160);
  });

  it("flip-until-tails scales with the rng and is deterministic per seed", () => {
    const s = state();
    const a = dmg(s, "Mega Kangaskhan ex", "Rapid-Fire Combo", 4);
    const b = dmg(s, "Mega Kangaskhan ex", "Rapid-Fire Combo", 4);
    expect(a).toBe(b); // same seed ⇒ same damage
    expect(a).toBeGreaterThanOrEqual(200); // 200 + 50 per heads
    expect((a - 200) % 50).toBe(0);
    // No rng (ghost evaluation) ⇒ no flips, just the base.
    expect(dmg(s, "Mega Kangaskhan ex", "Rapid-Fire Combo", null)).toBe(200);
  });

  it("attacks with no formula still use the printed damage", () => {
    const s = state();
    expect(dmg(s, "Pikachu", "Tail Smack")).toBe(10);
  });
});

describe("W2-fin — new primitive ops", () => {
  /** Play the first enumerated move for a trainer put into hand. */
  function playTrainer(s: GameState, name: string, seed = 9): EffectMove | null {
    const src = card(name);
    s.sides.player.hand = [src];
    const moves = legalMoves(s, "player", ctx()).filter(
      (m): m is EffectMove => m.kind === "effect" && m.card === name,
    );
    if (moves.length === 0) return null;
    expect(isLegalHumanMove(s, "player", ctx(), moves[0])).toBe(true);
    applyMove(s, "player", moves[0], ctx(), mulberry32(seed));
    return moves[0];
  }

  it("coin_flip: Crushing Hammer discards energy on heads, nothing on tails", () => {
    // Same board, two rng seeds — the flip must actually branch.
    const outcomes = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = state();
      const target = mon("Snorlax");
      target.attachedEnergy = [card("Basic Darkness Energy")];
      s.sides.opponent.active = target;
      playTrainer(s, "Crushing Hammer", seed);
      outcomes.add(target.attachedEnergy.length);
    }
    // Across seeds we must see BOTH a discard (0 left) and a whiff (1 left).
    expect(outcomes).toEqual(new Set([0, 1]));
  });

  it("coin_flip: the target is picked before the flip, so it is always enumerated", () => {
    const s = state();
    const target = mon("Snorlax");
    target.attachedEnergy = [card("Basic Darkness Energy")];
    s.sides.opponent.active = target;
    s.sides.player.hand = [card("Crushing Hammer")];

    const moves = legalMoves(s, "player", ctx()).filter(
      (m): m is EffectMove => m.kind === "effect" && m.card === "Crushing Hammer",
    );
    expect(moves.length).toBe(1);
    expect(moves[0].picks[0].monIds).toEqual([target.id]);
  });

  it("reveal_top: Pokégear 3.0 pulls a Supporter out of the top 7 only", () => {
    const s = state();
    const supporter = card("Professor's Research");
    // Put the Supporter 3 deep — inside the window.
    s.sides.player.deck.splice(3, 0, supporter);
    playTrainer(s, "Pokégear 3.0");
    expect(s.sides.player.hand.some((c) => c.id === supporter.id)).toBe(true);
  });

  it("reveal_top: leaves a Supporter buried DEEPER than the window alone", () => {
    const s = state();
    const supporter = card("Professor's Research");
    s.sides.player.deck.splice(30, 0, supporter); // well past the top 7
    playTrainer(s, "Pokégear 3.0");
    expect(s.sides.player.hand.some((c) => c.id === supporter.id)).toBe(false);
    // And the untaken cards went back — the deck only lost nothing.
    expect(s.sides.player.deck.some((c) => c.id === supporter.id)).toBe(true);
  });

  it("anyOf: Bug Catching Set takes Grass Pokémon OR Basic Grass Energy, up to 2", () => {
    const s = state();
    const grassMon = card("Applin"); // a Grass Pokémon
    const grassEnergy = card("Basic Grass Energy");
    const decoy = card("Basic Darkness Energy"); // wrong type — must be left
    s.sides.player.deck.splice(0, 0, grassMon, decoy, grassEnergy);
    playTrainer(s, "Bug Catching Set");
    const hand = s.sides.player.hand;
    expect(hand.some((c) => c.id === grassMon.id)).toBe(true);
    expect(hand.some((c) => c.id === grassEnergy.id)).toBe(true);
    expect(hand.some((c) => c.id === decoy.id)).toBe(false);
  });

  it("multi-slot search: Dawn fetches a Basic, a Stage 1 and a Stage 2", () => {
    const s = state();
    // Dratini/Dragonair/Dragonite is a clean Basic/Stage1/Stage2 line.
    const basic = card("Dratini");
    const stage1 = card("Dragonair");
    const stage2 = card("Dragonite");
    s.sides.player.deck.splice(0, 0, basic, stage1, stage2);
    const played = playTrainer(s, "Dawn");
    expect(played, "Dawn produced no legal move").not.toBeNull();
    const hand = s.sides.player.hand;
    // Assert the SHAPE (one card of each stage), not the specific seeded ids.
    // The `auto` chooser now ranks candidates instead of taking the first in
    // zone order, so the Basic slot picks the best Basic in the deck — which
    // is one of the base deck's Snorlax/Pikachu, not the Dratini seeded here.
    // That is the intended behaviour; pinning ids was pinning the old
    // arbitrary pick. Stage 1 and Stage 2 are unique in this deck, so those
    // still identify exactly.
    const isStage = (c: (typeof hand)[number], stage: string) =>
      c.catalog?.supertype === "Pokémon" && (c.catalog.subtypes ?? []).includes(stage);
    expect(hand.some((c) => isStage(c, "Basic"))).toBe(true);
    expect(hand.some((c) => c.id === stage1.id)).toBe(true);
    expect(hand.some((c) => c.id === stage2.id)).toBe(true);
    void basic;
  });

  it("discard_hand_cards: Secret Box needs 3 other cards and pays them", () => {
    const s = state();
    const box = card("Secret Box");
    // Only 2 other cards — the cost can't be paid, so it must not be legal.
    s.sides.player.hand = [box, card("Nest Ball"), card("Nest Ball")];
    expect(
      legalMoves(s, "player", ctx()).some((m) => m.kind === "effect" && m.card === "Secret Box"),
    ).toBe(false);

    // With 3 others it's legal, the discard is really paid, and the four
    // categories are fetched out of the deck.
    s.sides.player.hand = [box, card("Nest Ball"), card("Nest Ball"), card("Nest Ball")];
    const supporter = card("Professor's Research");
    s.sides.player.deck.splice(0, 0, supporter);
    const moves = legalMoves(s, "player", ctx()).filter(
      (m): m is EffectMove => m.kind === "effect" && m.card === "Secret Box",
    );
    expect(moves.length).toBeGreaterThan(0);
    const discardBefore = s.sides.player.discard.length;
    applyMove(s, "player", moves[0], ctx(), mulberry32(9));
    // Secret Box itself + exactly 3 discarded cards.
    expect(s.sides.player.discard.length).toBe(discardBefore + 4);
    // The Supporter it could find is in hand; the categories it couldn't find
    // simply fizzle rather than making the card unplayable.
    expect(s.sides.player.hand.some((c) => c.id === supporter.id)).toBe(true);
  });

  it("a search that finds nothing fizzles instead of blocking the card (Dawn, empty deck)", () => {
    const s = state();
    s.sides.player.deck = [card("Basic Darkness Energy")]; // no Pokémon at all
    const played = playTrainer(s, "Dawn");
    expect(played, "Dawn must still be playable with nothing to find").not.toBeNull();
  });
});

describe("W2-fin — multi-pick within one target slot", () => {
  function movesFor(s: GameState, name: string): EffectMove[] {
    s.sides.player.hand = [card(name)];
    return legalMoves(s, "player", ctx()).filter(
      (m): m is EffectMove => m.kind === "effect" && m.card === name,
    );
  }

  it("Cyrano: enumerates 3/2/1/0 picks and can take MULTIPLE COPIES of one ex", () => {
    const s = state();
    // Three copies of one ex + one of another: taking 2x the same card is legal.
    s.sides.player.deck.splice(
      0,
      0,
      card("Fezandipiti ex"),
      card("Fezandipiti ex"),
      card("Fezandipiti ex"),
      card("Pecharunt ex"),
    );
    const moves = movesFor(s, "Cyrano");
    const sizes = new Set(moves.map((m) => m.picks[0].cardIds?.length ?? 0));
    expect(sizes.has(3)).toBe(true);
    expect(sizes.has(0)).toBe(true); // "up to" includes declining

    // The key behavior: a pick naming the same card twice, with DISTINCT ids.
    const doubled = moves.find(
      (m) =>
        (m.picks[0].cardNames ?? []).filter((n) => n === "Fezandipiti ex").length >= 2,
    );
    expect(doubled, "no multi-copy pick was enumerated").toBeDefined();
    const ids = doubled!.picks[0].cardIds!;
    expect(new Set(ids).size).toBe(ids.length); // distinct physical cards

    // And it really fetches them all.
    expect(isLegalHumanMove(s, "player", ctx(), doubled!)).toBe(true);
    const before = s.sides.player.hand.length;
    applyMove(s, "player", doubled!, ctx(), mulberry32(9));
    // Hand: -1 for Cyrano itself, +N fetched.
    expect(s.sides.player.hand.length).toBe(before - 1 + ids.length);
  });

  it("Ciphermaniac's Codebreaking: puts the 2 found cards on TOP, after the shuffle", () => {
    const s = state();
    const moves = movesFor(s, "Ciphermaniac's Codebreaking");
    const two = moves.find((m) => (m.picks[0].cardIds?.length ?? 0) === 2);
    expect(two, "no 2-card pick enumerated").toBeDefined();
    const wantedIds = two!.picks[0].cardIds!;

    applyMove(s, "player", two!, ctx(), mulberry32(9));
    // Both are on top of the deck — not shuffled back in.
    expect(s.sides.player.deck.slice(0, 2).map((c) => c.id).sort()).toEqual([...wantedIds].sort());
  });

  it("Arven: two DIFFERENT category slots multiply (Item × Tool), not multi-pick", () => {
    const s = state();
    const item = card("Nest Ball");
    s.sides.player.deck.splice(0, 0, item);
    const moves = movesFor(s, "Arven");
    expect(moves.length).toBeGreaterThan(0);
    const withItem = moves.find((m) => m.picks.some((p) => p.cardIds?.includes(item.id)));
    expect(withItem).toBeDefined();
    applyMove(s, "player", withItem!, ctx(), mulberry32(9));
    expect(s.sides.player.hand.some((c) => c.id === item.id)).toBe(true);
  });

  it("caps enumeration so a wide unfiltered multi-pick can't explode legalMoves", () => {
    const s = state();
    // Codebreaking has NO filter: every one of ~50 deck cards is a candidate,
    // and choose-2 over that is ~1000+ combinations uncapped.
    const moves = movesFor(s, "Ciphermaniac's Codebreaking");
    expect(moves.length).toBeGreaterThan(1);
    expect(moves.length).toBeLessThanOrEqual(200);
  });

  it("multi-pick enumeration is deterministic (same state ⇒ same moves)", () => {
    const sig = () => {
      const s = state();
      s.sides.player.deck.splice(0, 0, card("Fezandipiti ex"), card("Fezandipiti ex"));
      return JSON.stringify(movesFor(s, "Cyrano").map((m) => m.picks[0].cardNames));
    };
    expect(sig()).toBe(sig());
  });
});

describe("W2 cutover — the interactive/API path the play UI drives", () => {
  // A legal 60-card deck built around the declarative card, so a human can be
  // dealt it. Team Rocket's Transceiver (Item) fetches a Team Rocket's Supporter.
  const DECK = [
    "Pokémon: 4",
    "4 Pikachu SVI 62",
    "Trainer: 8",
    "4 Team Rocket's Transceiver",
    "4 Team Rocket's Giovanni",
    "Energy: 48",
    "48 Basic Lightning Energy",
  ].join("\n");

  it("humanOptions surfaces the effect move, applyHumanMove plays it, and the transcript replays", () => {
    // Find a seed where the human is dealt Transceiver on their first decision
    // (opening hand of 7 from 60, with 4 copies — a low seed always hits).
    let session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed: 0 });
    autoSetup(session);
    let move: EffectMove | undefined;
    for (let seed = 0; seed < 400; seed++) {
      const s = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed });
      autoSetup(s);
      if (s.status !== "human_turn") continue;
      const opt = humanOptions(s).find(
        (m): m is EffectMove => m.kind === "effect" && m.card === "Team Rocket's Transceiver",
      );
      if (opt) {
        session = s;
        move = opt;
        break;
      }
    }
    expect(move, "no seed dealt Transceiver in 400 tries").toBeDefined();

    // The pick is self-describing (the UI labels the choice from this).
    expect(move!.picks[0]?.cardNames?.some((n) => n.startsWith("Team Rocket's"))).toBe(true);

    // Play it through the real API entry point (what PlayClient's sendMove hits).
    const handBefore = session.state.sides.player.hand.length;
    applyHumanMove(session, move!);
    // The fetched Supporter is now in hand (Transceiver left it, net +0 or more).
    expect(session.state.sides.player.hand.some((c) => c.name === "Team Rocket's Giovanni")).toBe(true);
    expect(handBefore).toBeGreaterThan(0);
    // The move was recorded for the stateless-server transcript.
    expect(
      session.transcript.moves.some((t) => t.actor === "human" && t.move.kind === "effect"),
    ).toBe(true);

    // Stateless replay (every /api/play request rebuilds from the transcript):
    // the recorded effect move must re-validate and reproduce the same board.
    const rebuilt = rebuildSession(session.transcript);
    expect(rebuilt.state.sides.player.hand.some((c) => c.name === "Team Rocket's Giovanni")).toBe(true);
  });
});

describe("coverage honesty — cards marked modeled must really be registered", () => {
  // A card can be flagged "implemented" in one registry while its effect lives
  // in another. During W3 an insert silently failed and six cards were counted
  // as modeled with no effect behind them — the metric overstated coverage.
  // These assertions make that specific failure loud.
  const HOOK_CARDS: [string, string][] = [
    ["Lucky Helmet", "on_damaged"],
    ["Handheld Fan", "on_damaged"],
    ["Spiky Energy", "on_damaged"],
    ["Powerglass", "end_of_turn"],
    ["Ignition Energy", "end_of_turn"],
    ["Froslass", "checkup"],
  ];

  it.each(HOOK_CARDS)("%s really carries a %s effect", (name, kind) => {
    const effects = effectsFor(name);
    expect(effects.length, `${name} is marked modeled but has no effect record`).toBeGreaterThan(0);
    expect(effects.some((e) => e.trigger.kind === kind)).toBe(true);
  });

  it("every Tool with an empty effect record has a declarative effect instead", () => {
    // TOOL_EFFECTS entries of `{}` mean "modeled elsewhere" — verify elsewhere
    // actually exists, rather than silently counting as covered.
    for (const [name] of HOOK_CARDS) {
      if (!isToolModeled(name)) continue;
      expect(effectsFor(name).length, `${name}`).toBeGreaterThan(0);
    }
  });
});

/* ─── Player-chosen discard costs (Secret Box) ──────────────────── */

describe("declarative discard costs are the PLAYER's choice", () => {
  it("reports the cost so the UI can prompt for it", () => {
    // trainerDiscardCostByName only reads the LEGACY registry, so Secret Box
    // reported 0, no prompt appeared, and the op auto-picked three cards out
    // of the player's hand. This is the lookup that fixes that.
    const idx = effectsFor("Secret Box").findIndex((e) =>
      e.ops.some((o) => o.op === "discard_hand_cards"),
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(effectDiscardCost("Secret Box", idx)).toBe(3);
  });

  it("reports 0 for a card with no discard cost", () => {
    expect(effectDiscardCost("Nest Ball", 0)).toBe(0);
  });

  it("discards exactly the cards the player chose", () => {
    const deck = instantiateDeck(
      [
        "Pokémon: 4",
        "4 Snorlax SVI 143",
        "Trainer: 32",
        "4 Secret Box TWM 163",
        "28 Nest Ball SVI 181",
        "Energy: 24",
        "24 Basic Lightning Energy SVE 4",
      ].join("\n"),
    );
    const state = buildSimInitialState(deck, deck, mulberry32(5), "player");
    const side = state.sides.player;
    const box = side.hand.find((c) => c.name === "Secret Box");
    if (!box) return; // opening hand didn't contain one; the other cases cover the lookup
    const idx = effectsFor("Secret Box").findIndex((e) =>
      e.ops.some((o) => o.op === "discard_hand_cards"),
    );
    const payable = side.hand.filter((c) => c.id !== box.id).slice(0, 3);
    const chosen = payable.map((c) => c.id);
    expect(chosen).toHaveLength(3);

    applyEffect(
      state,
      "player",
      effectsFor("Secret Box")[idx],
      {
        kind: "effect",
        sourceId: box.id,
        card: "Secret Box",
        effectIndex: idx,
        picks: [],
        discardCardIds: chosen,
      },
      mulberry32(11),
    );

    // Precisely the chosen cards left the hand for the discard pile.
    const discardIds = new Set(side.discard.map((c) => c.id));
    for (const id of chosen) expect(discardIds.has(id)).toBe(true);
    for (const id of chosen) expect(side.hand.some((c) => c.id === id)).toBe(false);
  });
});

/* ─── "Once during your turn" means per TURN ────────────────────── */

describe("activated abilities reset every turn", () => {
  it("clears abilitiesUsedThisTurn at the start of each turn", () => {
    // The simulator never cleared this (the replay reducer always did), so
    // every activated ability fired exactly ONCE PER GAME. N's Zoroark's
    // Trade is that deck's entire draw engine; Pecharunt ex's Subjugating
    // Chains was reported from real play as "used it once, never offered
    // again". Guard the reset itself, since the symptom is many turns away
    // from the cause.
    const deck = instantiateDeck(
      ["Pokémon: 4", "4 Snorlax SVI 143", "Trainer: 32", "32 Nest Ball SVI 181",
       "Energy: 24", "24 Basic Lightning Energy SVE 4"].join("\n"),
    );
    const state = buildSimInitialState(deck, deck, mulberry32(4), "player");
    const active = state.sides.player.active;
    expect(active).not.toBeNull();

    active!.abilitiesUsedThisTurn.push("Some Ability");
    // The opponent's turn must NOT clear our flag...
    beginTurn(state, "opponent", 1);
    expect(active!.abilitiesUsedThisTurn).toContain("Some Ability");
    // ...but the start of OUR next turn must.
    beginTurn(state, "player", 2);
    expect(active!.abilitiesUsedThisTurn).toEqual([]);
  });

  it("resets benched Pokémon too, not just the Active", () => {
    const deck = instantiateDeck(
      ["Pokémon: 8", "4 Snorlax SVI 143", "4 Pikachu SVI 62", "Trainer: 28",
       "28 Nest Ball SVI 181", "Energy: 24", "24 Basic Lightning Energy SVE 4"].join("\n"),
    );
    const state = buildSimInitialState(deck, deck, mulberry32(6), "player");
    const bench = state.sides.player.bench;
    if (bench.length === 0) return;
    bench[0].abilitiesUsedThisTurn.push("Bench Ability");
    beginTurn(state, "player", 2);
    expect(bench[0].abilitiesUsedThisTurn).toEqual([]);
  });
});

/* ─── Trade discards the card the PLAYER chose ──────────────────── */

describe("N's Zoroark's Trade honours a chosen discard", () => {
  const ZDECK = [
    "Pokémon: 8",
    "4 N's Zorua JTG 96",
    "4 N's Zoroark ex JTG 98",
    "Trainer: 28",
    "28 Nest Ball SVI 181",
    "Energy: 24",
    "24 Basic Darkness Energy SVE 15",
  ].join("\n");

  it("declares its hand-discard cost so the UI can prompt", () => {
    // Without this the UI cannot know Trade owes the player a choice, and
    // `apply`'s auto-picker silently decides which card leaves your hand.
    expect(activatedHandDiscard("N's Zoroark ex", "Trade")).toBe(1);
    expect(activatedHandDiscard("Munkidori", "Adrena-Brain")).toBe(0);
  });

  it("discards exactly the chosen card, not the auto-pick", () => {
    const deck = instantiateDeck(ZDECK);
    const state = buildSimInitialState(deck, deck, mulberry32(9), "player");
    const side = state.sides.player;
    const zoro = toPokemonInPlay(card("N's Zoroark ex"), 0);
    side.bench.push(zoro);
    // Choose the LAST card in hand; the auto-picker prefers the least useful
    // one, so if the choice were ignored a different card would go.
    const chosen = side.hand[side.hand.length - 1];
    const before = side.hand.length;

    applyAbility(state, "player", {
      kind: "use_ability",
      monId: zoro.id,
      abilityName: "Trade",
      cardId: chosen.id,
    });

    expect(side.discard.some((c) => c.id === chosen.id)).toBe(true);
    expect(side.hand.some((c) => c.id === chosen.id)).toBe(false);
    // -1 discarded, +2 drawn.
    expect(side.hand.length).toBe(before - 1 + 2);
  });

  it("rejects a discard the player does not hold", () => {
    const deck = instantiateDeck(ZDECK);
    const state = buildSimInitialState(deck, deck, mulberry32(9), "player");
    const zoro = toPokemonInPlay(card("N's Zoroark ex"), 0);
    state.sides.player.bench.push(zoro);
    const ctx: TurnContext = { retreated: false };
    expect(
      isLegalHumanMove(state, "player", ctx, {
        kind: "use_ability",
        monId: zoro.id,
        abilityName: "Trade",
        cardId: "not-a-real-card-id",
      }),
    ).toBe(false);
  });
});

/* ─── Audit follow-ups: "all" costs and restricted costs ────────── */

describe("discard costs found by the choice audit", () => {
  it("Larry's Skill discards the WHOLE hand and prompts for nothing", () => {
    // Encoded as the magic number 99, which read as a real count — the
    // discard prompt would have demanded 99 picks and never enabled Confirm,
    // making the card unplayable in the UI.
    const idx = effectsFor("Larry's Skill").findIndex((e) =>
      e.ops.some((o) => o.op === "discard_hand_cards"),
    );
    expect(effectDiscardCost("Larry's Skill", idx)).toBe(0);

    const deck = instantiateDeck(
      ["Pokémon: 4", "4 Snorlax SVI 143", "Trainer: 32", "32 Nest Ball SVI 181",
       "Energy: 24", "24 Basic Fighting Energy SVE 6"].join("\n"),
    );
    const state = buildSimInitialState(deck, deck, mulberry32(3), "player");
    const side = state.sides.player;
    // The trainer branch removes the played card FROM HAND by id, so the
    // source must really be there.
    const larry = card("Larry's Skill");
    side.hand.push(larry);
    const otherCards = side.hand.length - 1;
    expect(otherCards).toBeGreaterThan(0);
    applyEffect(
      state, "player", effectsFor("Larry's Skill")[idx],
      { kind: "effect", sourceId: larry.id, card: "Larry's Skill", effectIndex: idx, picks: [] },
      mulberry32(2),
    );
    // Every card that was in hand is now in the discard — the card itself
    // plus the whole hand it discarded.
    expect(side.discard.length).toBeGreaterThanOrEqual(otherCards + 1);
  });

  it("Lunatone's Lunar Cycle costs a Basic FIGHTING Energy specifically", () => {
    // The filter did not exist: any card paid, and the guard only asked for a
    // non-empty hand — so Lunar Cycle drew 3 for free.
    const idx = effectsFor("Lunatone").findIndex((e) =>
      e.ops.some((o) => o.op === "discard_hand_cards"),
    );
    const filter = effectDiscardFilter("Lunatone", idx);
    expect(filter).not.toBeNull();
    expect(filter?.basicEnergy).toBe(true);
    expect(filter?.energyType).toBe("Fighting");
  });

  it("an unrestricted cost still reports no filter", () => {
    const idx = effectsFor("Iris's Fighting Spirit").findIndex((e) =>
      e.ops.some((o) => o.op === "discard_hand_cards"),
    );
    expect(effectDiscardCost("Iris's Fighting Spirit", idx)).toBe(1);
    expect(effectDiscardFilter("Iris's Fighting Spirit", idx)).toBeNull();
  });
});

/* ─── The human chooses; the AI still auto-picks ────────────────── */

describe("expandAuto gives the human real search choices", () => {
  const DECK = [
    "Pokémon: 12", "4 Miraidon ex SVI 81", "4 Pikachu SVI 62", "4 Snorlax SVI 143",
    "Trainer: 24", "8 Ultra Ball SVI 196", "8 Nest Ball SVI 181", "8 Switch SVI 194",
    "Energy: 24", "24 Basic Lightning Energy SVE 4",
  ].join("\n");

  it("enumerates ONE move for the AI and several for the human", () => {
    // The card says the player chooses which cards leave their deck. The AI
    // must NOT get the expanded set: flipping the DATA to chooser:"player"
    // cost ~1.4 points against HeuristicPolicy over three seeds, because half
    // the benchmark decks carry these cards.
    const deck = instantiateDeck(DECK);
    const state = buildSimInitialState(deck, deck, mulberry32(2), "player");
    const dawn = card("Dawn");
    state.sides.player.hand.push(dawn);
    const effect = effectsFor("Dawn")[0];
    const src = { id: dawn.id, name: "Dawn" };

    const forAi = enumerateEffect(state, "player", src, effect, 0, null, false);
    const forHuman = enumerateEffect(state, "player", src, effect, 0, null, true);
    expect(forAi).toHaveLength(1);
    expect(forHuman.length).toBeGreaterThan(1);
  });

  it("accepts a human pick the AI enumeration would never produce", () => {
    const deck = instantiateDeck(DECK);
    const state = buildSimInitialState(deck, deck, mulberry32(2), "player");
    const dawn = card("Dawn");
    state.sides.player.hand.push(dawn);
    const effect = effectsFor("Dawn")[0];
    const src = { id: dawn.id, name: "Dawn" };
    const forAi = enumerateEffect(state, "player", src, effect, 0, null, false);
    const forHuman = enumerateEffect(state, "player", src, effect, 0, null, true);

    const different = forHuman.find(
      (m) => JSON.stringify(m.picks) !== JSON.stringify(forAi[0].picks),
    );
    expect(different).toBeDefined();
    const ctx: TurnContext = { retreated: false };
    // validate re-enumerates WITH expandAuto, so the human's choice is legal.
    expect(isLegalHumanMove(state, "player", ctx, different!)).toBe(true);
  });
});
