// The opening board is the HUMAN's to place.
//
// setupSide auto-placed both boards — best Basic Active, every remaining
// Basic Benched — and the interactive session inherited that silently, so a
// person never chose their starting Pokémon. These cover the new
// "human_setup" pause: what it offers, what it refuses, and that finishing
// it lands in exactly the game the old auto-placement produced.
//
// Also here: Special Red Card's prize gate, verified through the same
// human path rather than through trainerMoves directly (trainers.test.ts
// covers the enumerator; this covers what the UI is actually handed).

import { describe, it, expect } from "vitest";
import {
  startGame,
  applyHumanMove,
  humanOptions,
  autoSetup,
  rebuildSession,
  IllegalMoveError,
} from "./index";
import type { GameSession, SetupMove } from "./index";
import { buildSimInitialState, instantiateDeck } from "./setup";
import { mulberry32 } from "./rng";
import { legalMoves } from "./moves";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";

const DECK = [
  "Pokémon: 12",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "4 Munkidori TWM 95",
  "Trainer: 20",
  "8 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 28",
  "28 Basic Darkness Energy",
].join("\n");

const fresh = (seed: number) =>
  startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed });

const setupKinds = (s: GameSession) => humanOptions(s).map((m) => m.kind);

describe("opening setup is the human's decision", () => {
  it("pauses before turn 1 and offers every Basic in hand as the Active", () => {
    const s = fresh(11);
    expect(s.status).toBe("human_setup");
    expect(s.state.sides.player.active).toBeNull();

    const options = humanOptions(s) as SetupMove[];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((m) => m.kind === "setup_active")).toBe(true);
    // Exactly the Basics in hand — no more, no fewer.
    const offered = new Set(options.map((m) => (m as { cardId: string }).cardId));
    const basics = s.state.sides.player.hand.filter(
      (c) => c.catalog?.supertype === "Pokémon" && !c.catalog.evolves_from,
    );
    expect(offered).toEqual(new Set(basics.map((c) => c.id)));
  });

  it("hides the AI's board until the human commits", () => {
    const s = fresh(11);
    // Both boards empty while choosing: seeing the AI's lead would make the
    // human's own choice strictly easier than the real game allows.
    expect(s.state.sides.opponent.active).toBeNull();
    expect(s.state.sides.opponent.bench.length).toBe(0);
    autoSetup(s);
    expect(s.state.sides.opponent.active).not.toBeNull();
  });

  it("refuses turn moves during setup, and setup moves after it", () => {
    const s = fresh(11);
    expect(() => applyHumanMove(s, { kind: "pass" })).toThrow(IllegalMoveError);
    expect(() => applyHumanMove(s, { kind: "setup_done" })).toThrow(IllegalMoveError); // no Active yet
    autoSetup(s);
    expect(() => applyHumanMove(s, { kind: "setup_bench", cardId: "nope" })).toThrow(
      IllegalMoveError,
    );
  });

  it("benches only after an Active is chosen, and never more than 5", () => {
    // A seed whose opening hand holds more than one Basic, so there is
    // something left to Bench after the Active is placed.
    let s = fresh(11);
    for (let seed = 11; seed < 61; seed++) {
      s = fresh(seed);
      if (humanOptions(s).length > 1) break;
    }
    const first = (humanOptions(s) as SetupMove[])[0];
    applyHumanMove(s, first);
    expect(s.state.sides.player.active).not.toBeNull();
    // Now Bench options plus the two commands, in that order — a caller
    // taking options[0] must keep benching rather than loop on reset.
    expect(setupKinds(s)).toContain("setup_bench");
    expect(setupKinds(s).slice(-2)).toEqual(["setup_done", "setup_reset"]);

    while (humanOptions(s).some((m) => m.kind === "setup_bench")) {
      applyHumanMove(s, humanOptions(s).find((m) => m.kind === "setup_bench")!);
    }
    expect(s.state.sides.player.bench.length).toBeLessThanOrEqual(5);
  });

  it("setup_reset returns the whole board to hand", () => {
    const s = fresh(11);
    const handSize = s.state.sides.player.hand.length;
    autoSetupPartial(s);
    expect(s.state.sides.player.hand.length).toBeLessThan(handSize);
    applyHumanMove(s, { kind: "setup_reset" });
    expect(s.state.sides.player.active).toBeNull();
    expect(s.state.sides.player.bench.length).toBe(0);
    expect(s.state.sides.player.hand.length).toBe(handSize);
  });

  it("autoSetup reproduces the board the headless sim builds", () => {
    const seed = 11;
    const s = fresh(seed);
    autoSetup(s);

    // Same seed, same rng draws (the coin flip, then both setups) — the
    // headless path auto-places, so the boards must be identical.
    const rng = mulberry32(seed);
    rng(); // the coin flip startGame records as human_first
    const headless = buildSimInitialState(
      instantiateDeck(DECK, "h"),
      instantiateDeck(DECK, "a"),
      rng,
      s.transcript.human_first ? "player" : "opponent",
    );
    const board = (side: { active: unknown; bench: { card: { name: string } }[] }) => [
      (side.active as { card: { name: string } } | null)?.card.name ?? null,
      ...side.bench.map((m) => m.card.name),
    ];
    // The human's board only: if the AI moves first, autoSetup already ran
    // its whole opening turn, so its board is no longer the freshly-placed one.
    expect(board(s.state.sides.player)).toEqual(board(headless.sides.player));
  });

  it("records setup in the transcript so a rebuilt session matches", () => {
    const s = fresh(11);
    autoSetup(s);
    applyHumanMove(s, { kind: "pass" });

    const rebuilt = rebuildSession(s.transcript);
    expect(rebuilt.status).toBe(s.status);
    expect(rebuilt.state.sides.player.active?.card.name).toBe(
      s.state.sides.player.active?.card.name,
    );
    expect(rebuilt.state.sides.player.bench.map((m) => m.card.name)).toEqual(
      s.state.sides.player.bench.map((m) => m.card.name),
    );
  });
});

/** Place an Active and one Benched Pokémon, then stop. */
function autoSetupPartial(s: GameSession): void {
  applyHumanMove(s, (humanOptions(s) as SetupMove[])[0]);
  const bench = humanOptions(s).find((m) => m.kind === "setup_bench");
  if (bench) applyHumanMove(s, bench);
}

describe("Special Red Card's prize gate, through the human path", () => {
  it("is withheld until the opponent is down to 3 Prizes", () => {
    const s = fresh(11);
    autoSetup(s);
    // Force the human's turn so options are real turn moves.
    while (s.status !== "human_turn" && s.status !== "over") {
      applyHumanMove(s, humanOptions(s)[0]);
    }
    const me = s.state.sides.player;
    const card = {
      id: mintInstanceId("srt"),
      name: "Special Red Card",
      catalog: lookupCard("Special Red Card"),
    };
    expect(card.catalog?.supertype).toBe("Trainer"); // the gate needs the catalog
    me.hand.push(card);

    // expandAuto=true is what humanOptions passes — the UI's own view.
    const offered = () =>
      legalMoves(s.state, "player", s.ctx, true).filter(
        (m) => "cardId" in m && m.cardId === card.id,
      );

    expect(s.state.sides.opponent.prizes.length).toBe(6);
    expect(offered()).toEqual([]); // 4+ Prizes ⇒ unplayable, and NOT cycled

    s.state.sides.opponent.prizes.splice(0, 3); // opponent has taken 3
    expect(offered().length).toBeGreaterThan(0);
  });
});
