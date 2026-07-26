// Pokémon abilities: Munkidori (move counters, Darkness gate, once/turn),
// Dusknoir (place 13 + self-KO), and Charizard ex's on-evolve energy accel.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { applyMove, beginTurn } from "./driver";
import { legalMoves, type SimMove } from "./moves";
import { placeCounters, resolveKnockouts } from "./damage";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState, PokemonInPlay } from "../types";
import type { UseAbilityMove } from "./abilities";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string, turn = 0): PokemonInPlay => toPokemonInPlay(card(n), turn);

function state(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 4", "4 Pikachu SVI 62", "Energy: 56", "56 Basic Darkness Energy"].join("\n"),
    "t",
  );
  const s = buildSimInitialState(deck, deck, mulberry32(1), "player");
  s.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  return s;
}

function abilityMovesFor(s: GameState): UseAbilityMove[] {
  return legalMoves(s, "player", { retreated: false }).filter(
    (m): m is UseAbilityMove => m.kind === "use_ability",
  );
}
const apply = (s: GameState, m: SimMove) => applyMove(s, "player", m, { retreated: false }, mulberry32(9));

describe("Munkidori — Adrena-Brain", () => {
  it("moves up to 3 counters from own to opponent, only with Darkness energy", () => {
    const s = state();
    const munki = mon("Munkidori");
    const damaged = mon("Snorlax");
    placeCounters(damaged, 5); // 50 damage
    s.sides.player.active = munki;
    s.sides.player.bench = [damaged];
    s.sides.opponent.active = mon("Pikachu");

    // No Darkness energy attached ⇒ ability unavailable.
    expect(abilityMovesFor(s)).toHaveLength(0);

    munki.attachedEnergy.push(card("Basic Darkness Energy"));
    const moves = abilityMovesFor(s);
    expect(moves.length).toBeGreaterThan(0);
    const move = moves.find((m) => m.sourceMonId === damaged.id && m.targetMonId === s.sides.opponent.active!.id)!;
    apply(s, move);
    expect(damaged.damage).toBe(20); // 50 − 30 moved
    expect(s.sides.opponent.active!.damage).toBe(30);
  });

  it("is once per turn per Pokémon", () => {
    const s = state();
    const munki = mon("Munkidori");
    munki.attachedEnergy.push(card("Basic Darkness Energy"));
    const damaged = mon("Snorlax");
    placeCounters(damaged, 5);
    s.sides.player.active = munki;
    s.sides.player.bench = [damaged];
    s.sides.opponent.active = mon("Pikachu");
    apply(s, abilityMovesFor(s)[0]);
    expect(abilityMovesFor(s)).toHaveLength(0); // used up
  });
});

describe("Dusknoir — Cursed Blast", () => {
  it("places 13 counters then Knocks itself Out (opponent takes its prize)", () => {
    const s = state();
    const dusk = mon("Dusknoir");
    s.sides.player.active = dusk;
    s.sides.player.bench = [mon("Pikachu")]; // so we can promote after self-KO
    const target = mon("Miraidon ex"); // 220 HP
    s.sides.opponent.active = target;
    const oppPrizesBefore = s.prizesTaken.opponent;

    const move = abilityMovesFor(s).find((m) => m.abilityName === "Cursed Blast")!;
    const result = apply(s, move);
    expect(target.damage).toBe(130); // 13 counters
    // Dusknoir self-KO'd: gone from play, opponent took a prize for it.
    expect(s.prizesTaken.opponent).toBe(oppPrizesBefore + 1);
    expect(result.pendingPromotion).toBe("player");
  });
});

describe("N's Zoroark ex — Trade", () => {
  it("discards one card from hand and draws 2, once per turn", () => {
    const s = state();
    const zoro = mon("N's Zoroark ex");
    s.sides.player.active = zoro;
    s.sides.opponent.active = mon("Pikachu");
    s.sides.player.hand = [card("Pikachu"), card("Basic Darkness Energy")];
    const handBefore = s.sides.player.hand.length;
    const deckBefore = s.sides.player.deck.length;
    const discardBefore = s.sides.player.discard.length;

    const move = abilityMovesFor(s).find((m) => m.abilityName === "Trade")!;
    expect(move).toBeTruthy();
    apply(s, move);

    // −1 discarded, +2 drawn ⇒ net +1 hand; deck −2; discard +1.
    expect(s.sides.player.hand.length).toBe(handBefore + 1);
    expect(s.sides.player.deck.length).toBe(deckBefore - 2);
    expect(s.sides.player.discard.length).toBe(discardBefore + 1);
    // Used up for the turn.
    expect(abilityMovesFor(s).some((m) => m.abilityName === "Trade")).toBe(false);
  });

  it("is unavailable with an empty hand or empty deck", () => {
    const s = state();
    const zoro = mon("N's Zoroark ex");
    s.sides.player.active = zoro;
    s.sides.opponent.active = mon("Pikachu");
    s.sides.player.hand = [];
    expect(abilityMovesFor(s).some((m) => m.abilityName === "Trade")).toBe(false);
    s.sides.player.hand = [card("Pikachu")];
    s.sides.player.deck = [];
    expect(abilityMovesFor(s).some((m) => m.abilityName === "Trade")).toBe(false);
  });
});

describe("Fezandipiti ex — Flip the Script", () => {
  it("is available only after you were KO'd on the opponent's turn, then draws 3", () => {
    const s = state();
    const fez = mon("Fezandipiti ex");
    s.sides.player.active = fez;
    s.sides.opponent.active = mon("Pikachu");

    // No comeback trigger yet ⇒ unavailable.
    expect(abilityMovesFor(s).some((m) => m.abilityName === "Flip the Script")).toBe(false);

    s.sides.player.koedLastOppTurn = true;
    const move = abilityMovesFor(s).find((m) => m.abilityName === "Flip the Script")!;
    expect(move).toBeTruthy();
    const deckBefore = s.sides.player.deck.length;
    const handBefore = s.sides.player.hand.length;
    apply(s, move);
    expect(s.sides.player.hand.length).toBe(handBefore + 3);
    expect(s.sides.player.deck.length).toBe(deckBefore - 3);
  });

  it("the KO flag is set when the opponent KOs you on their turn, cleared at their next turn", () => {
    const s = state();
    s.turn.actor = "opponent"; // opponent's turn
    const dying = mon("Snorlax");
    placeCounters(dying, 100); // lethal for Snorlax's HP
    s.sides.player.active = dying;
    s.sides.player.bench = [mon("Pikachu")]; // avoid game end
    s.sides.opponent.active = mon("Pikachu");

    resolveKnockouts(s);
    expect(s.sides.player.koedLastOppTurn).toBe(true);

    // Cleared when the opponent's next turn begins (the player already read it).
    beginTurn(s, "opponent", 3);
    expect(s.sides.player.koedLastOppTurn).toBe(false);
  });
});

describe("Tatsugiri — Attract Customers", () => {
  it("pulls a Supporter from the top 6 to hand when Active", () => {
    const s = state();
    const tatsu = mon("Tatsugiri");
    s.sides.player.active = tatsu;
    s.sides.opponent.active = mon("Pikachu");
    // Seed a Supporter within the top 6.
    s.sides.player.deck.splice(3, 0, card("Iono"));
    const handBefore = s.sides.player.hand.length;

    const move = abilityMovesFor(s).find((m) => m.abilityName === "Attract Customers")!;
    expect(move).toBeTruthy();
    apply(s, move);
    expect(s.sides.player.hand.some((c) => c.name === "Iono")).toBe(true);
    expect(s.sides.player.hand.length).toBe(handBefore + 1);
  });

  it("is unavailable when Tatsugiri is on the Bench", () => {
    const s = state();
    const tatsu = mon("Tatsugiri");
    s.sides.player.active = mon("Pikachu");
    s.sides.player.bench = [tatsu];
    s.sides.player.deck.splice(3, 0, card("Iono"));
    s.sides.opponent.active = mon("Pikachu");
    expect(abilityMovesFor(s).some((m) => m.abilityName === "Attract Customers")).toBe(false);
  });
});

describe("Charizard ex — Infernal Reign (on evolve)", () => {
  it("attaches up to 3 Basic Fire Energy from deck when it evolves", () => {
    const deck = instantiateDeck(
      [
        "Pokémon: 9",
        "3 Charmander",
        "3 Charmeleon",
        "3 Charizard ex",
        "Energy: 51",
        "51 Basic Fire Energy",
      ].join("\n"),
      "t",
    );
    const s = buildSimInitialState(deck, deck, mulberry32(2), "player");
    s.turn = { number: 5, playerTurnNumber: 3, actor: "player", phase: "turn" };
    const charmeleon = mon("Charmeleon", 2); // in play since earlier
    s.sides.player.active = charmeleon;
    const zard = card("Charizard ex");
    s.sides.player.hand = [zard];
    const fireBefore = s.sides.player.deck.filter((c) => c.name.includes("Fire Energy")).length;

    apply(s, { kind: "evolve", cardId: zard.id, targetId: charmeleon.id });
    expect(charmeleon.card.name).toBe("Charizard ex");
    // Up to 3 Fire Energy pulled from the deck onto it.
    expect(charmeleon.attachedEnergy.length).toBe(3);
    expect(s.sides.player.deck.filter((c) => c.name.includes("Fire Energy")).length).toBe(fireBefore - 3);
  });
});
