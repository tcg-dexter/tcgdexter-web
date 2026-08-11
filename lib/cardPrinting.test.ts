// Deck-list parsing, and specifically the boundary between the two forms
// a line can take.
//
// parseDeckListCards buffers a whole section and extracts cards with two
// regex passes: one for "<qty> <name> <SETCODE> <number>", one for the
// set-code-less "<qty> <name>". The buffering is deliberate — it recovers
// lists mangled by source wrapping, where a card's set code lands on the
// next line.
//
// The cost of buffering is that the two forms can collide. Pass 1's name
// group used to be an unconstrained `.+?`, so a set-code-less card sitting
// before a set-coded one was absorbed into the LATTER'S NAME and vanished:
//
//     4 Rare Candy            ⎫
//     3 Nest Ball SVI 181     ⎭ → one card, "Rare Candy 3 Nest Ball"
//
// Mixed lists are normal (people hand-edit exports, and TCG Live omits the
// set code for some promos), and the failure was silent — the deck just
// came out short, with a bogus name that then failed catalog lookup. It
// reached the simulator, where a 60-card list became a 35-card one.

import { describe, it, expect } from "vitest";
import { ROTATING_MARKS, isStandardMark, parseDeckListCards } from "./cardPrinting";
import { standardPrintingsOf } from "./engine/catalog";

const names = (list: string) => parseDeckListCards(list).map((c) => c.name);
const qtys = (list: string) => parseDeckListCards(list).reduce((n, c) => n + c.qty, 0);

describe("parseDeckListCards — mixing set-coded and set-code-less lines", () => {
  it("keeps a set-code-less card that precedes a set-coded one", () => {
    const list = ["Trainer: 7", "4 Rare Candy", "3 Nest Ball SVI 181"].join("\n");
    expect(names(list)).toEqual(["Rare Candy", "Nest Ball"]);
    expect(qtys(list)).toBe(7);
  });

  it("keeps one sandwiched between two set-coded cards", () => {
    const list = [
      "Trainer: 11",
      "2 Iono PAL 185",
      "4 Rare Candy",
      "3 Nest Ball SVI 181",
      "2 Switch",
    ].join("\n");
    expect(names(list)).toEqual(["Iono", "Rare Candy", "Nest Ball", "Switch"]);
    expect(qtys(list)).toBe(11);
  });

  it("preserves source order across both passes", () => {
    // The passes run set-coded-first, so without an explicit re-sort the
    // output order bore no relation to the list the user typed.
    const list = [
      "Trainer: 10",
      "1 Alpha",
      "2 Beta SVI 1",
      "3 Gamma",
      "4 Delta PAL 2",
    ].join("\n");
    expect(names(list)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("still recovers a list mangled by source wrapping", () => {
    // The reason the section is buffered at all: the set code wrapped onto
    // the following line, and two cards share that line.
    const list = ["Pokémon: 3", "1 Chien-Pao", "PR-SV 152 2 Lillie's Clefairy ex JTG 173"].join(
      "\n",
    );
    const cards = parseDeckListCards(list);
    expect(cards.map((c) => c.name)).toEqual(["Chien-Pao", "Lillie's Clefairy ex"]);
    expect(cards.map((c) => c.setCode)).toEqual(["PR-SV", "JTG"]);
  });

  it("does not split a name that merely contains a digit", () => {
    const list = ["Trainer: 7", "3 Pokégear 3.0 SVI 186", "4 Bug Catching Set TWM 143"].join("\n");
    expect(names(list)).toEqual(["Pokégear 3.0", "Bug Catching Set"]);
  });

  it("parses a full 60-card mixed list to 60 cards", () => {
    const list = [
      "Pokémon: 14",
      "4 N's Zorua",
      "3 N's Zoroark ex",
      "2 Fezandipiti ex",
      "2 Munkidori TWM 95",
      "3 N's Reshiram",
      "Trainer: 26",
      "4 Ultra Ball SVI 196",
      "4 Buddy-Buddy Poffin",
      "3 Rare Candy",
      "3 Boss's Orders",
      "4 Iono",
      "4 Professor's Research",
      "4 Nest Ball SVI 181",
      "Energy: 20",
      "20 Basic Darkness Energy",
    ].join("\n");
    expect(qtys(list)).toBe(60);
    expect(parseDeckListCards(list)).toHaveLength(13); // 5 + 7 + 1 lines
  });
});

// Regulation marks drifted once: lib/engine/catalog.ts kept its own
// CURRENT_STANDARD_MARKS listing G as Standard after G had rotated out, while
// cardPrinting.ts correctly treated it as rotated. The two disagreed for
// ~1,600 printings — worst on SVP, where 112 of 226 cards carry mark G. These
// guard the single source of truth that replaced the second list.
describe("regulation marks", () => {
  it("treats G and older as rotated, H and newer as Standard", () => {
    for (const mark of ["A", "B", "C", "D", "E", "F", "G"]) {
      expect(ROTATING_MARKS.has(mark)).toBe(true);
      expect(isStandardMark(mark)).toBe(false);
    }
    for (const mark of ["H", "I", "J"]) {
      expect(ROTATING_MARKS.has(mark)).toBe(false);
      expect(isStandardMark(mark)).toBe(true);
    }
  });

  it("is case-insensitive, and treats an absent mark as not Standard", () => {
    expect(isStandardMark("i")).toBe(true);
    expect(isStandardMark("g")).toBe(false);
    // Pre-mark promos and energies: legality is decided elsewhere, and
    // defaulting them to Standard would let any Base-era card through.
    expect(isStandardMark(null)).toBe(false);
    expect(isStandardMark(undefined)).toBe(false);
    expect(isStandardMark("")).toBe(false);
  });

  it("keeps the engine catalog in agreement rather than on its own list", () => {
    // Every printing the engine calls Standard must satisfy isStandardMark —
    // the property that failed while the two lists were maintained separately.
    const printings = standardPrintingsOf("Pikachu");
    for (const p of printings) {
      expect(isStandardMark(p.regulation_mark)).toBe(true);
    }
    expect(printings.every((p) => p.regulation_mark !== "G")).toBe(true);
  });
});
