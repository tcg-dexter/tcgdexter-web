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
import { applyMove } from "../driver";
import { isLegalHumanMove } from "../validate";
import { describeMove } from "../serialize";
import { legalMoves, type SimMove, type TurnContext } from "../moves";
import { HeuristicPolicy } from "../policy";
import { viewFor } from "../view";
import { startGame, applyHumanMove, rebuildSession, humanOptions } from "../interactive";
import { enumerateEffect, type EffectMove } from "./runtime";
import { effectsFor } from "./cards";

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
    let move: EffectMove | undefined;
    for (let seed = 0; seed < 400; seed++) {
      const s = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed });
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
