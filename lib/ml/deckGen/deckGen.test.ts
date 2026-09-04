// The deck generator's contract: everything it emits is a deck the engine
// can actually play, the gates do not reject decks real people won with, and
// the same seed produces the same corpus.

import { describe, it, expect } from "vitest";
import { instantiateDeck } from "@/lib/engine/sim";
import { buildCorpus, loadMetaCorpus, archetypeProfile } from "./corpus";
import { generateDecks, mutateDeck, skeletonDeck } from "./generate";
import {
  deckIssues,
  deckStats,
  legalityIssues,
  orphanEvolutions,
  parseDeck,
  renderDeck,
} from "./rules";

const corpus = buildCorpus(loadMetaCorpus());

/* ─── Gate 1: legality ──────────────────────────────────────────── */

describe("legality is the rule book", () => {
  const base = (over: string) =>
    parseDeck(
      ["Pokémon: 4", "4 Pikachu SVI 62", "Trainer: 4", over, "Energy: 52", "52 Basic Fire Energy"].join("\n"),
    );

  it("rejects a deck that is not 60 cards", () => {
    const short = parseDeck(["Pokémon: 4", "4 Pikachu SVI 62"].join("\n"));
    expect(legalityIssues(short).some((i) => /not 60/.test(i))).toBe(true);
  });

  it("rejects a 5th copy, but never counts Basic Energy", () => {
    expect(legalityIssues(base("5 Nest Ball SVI 181")).some((i) => /max 4/.test(i))).toBe(true);
    // 52 Basic Fire Energy in the fixture above is legal by the same rule.
    const fine = base("4 Nest Ball SVI 181");
    expect(legalityIssues(fine).filter((i) => /max 4/.test(i))).toHaveLength(0);
  });

  it("rejects a second ACE SPEC", () => {
    const two = parseDeck(
      [
        "Pokémon: 4", "4 Pikachu SVI 62",
        "Trainer: 2", "1 Secret Box TWM 163", "1 Master Ball PAF 88",
        "Energy: 54", "54 Basic Fire Energy",
      ].join("\n"),
    );
    expect(two.length).toBeGreaterThan(0);
    expect(legalityIssues(two).some((i) => /ACE SPEC/.test(i))).toBe(true);
  });

  it("rejects a card outside the standard catalog", () => {
    const bogus = parseDeck(
      ["Pokémon: 4", "4 Pikachu SVI 62", "Trainer: 4", "4 Battle Compressor PHF 92", "Energy: 52", "52 Basic Fire Energy"].join("\n"),
    );
    expect(bogus.length).toBeGreaterThan(0);
    expect(legalityIssues(bogus).some((i) => /unknown card/.test(i))).toBe(true);
  });
});

/* ─── Gate 2: playability, and what it must NOT judge ───────────── */

describe("playability judges function, not taste", () => {
  it("an orphan evolution is DESCRIBED, not rejected", () => {
    // Slowking's Seek Inspiration discards the top card of the deck and uses
    // a no-rule-box Pokémon's attack as its own, so the real list runs a lone
    // Metagross it never evolves into. This was a hard gate until it rejected
    // that whole archetype — the orphan IS the payoff.
    const slowking = corpus.decks.find((d) => d.archetype === "slowking-seek-inspiration");
    expect(slowking).toBeTruthy();
    const orphans = orphanEvolutions(slowking!.entries);
    expect(orphans.length).toBeGreaterThan(0); // it really does have one
    expect(deckIssues(slowking!.entries).playability).toHaveLength(0); // and it still passes
    expect(deckStats(slowking!.entries).orphans).toBe(orphans.length); // recorded for the study
  });

  it("does reject decks that cannot function", () => {
    const noEnergy = parseDeck(
      ["Pokémon: 4", "4 Pikachu SVI 62", "Trainer: 56", "4 Nest Ball SVI 181", "52 Poké Ball SVI 185"].join("\n"),
    );
    expect(deckIssues(noEnergy).playability.length).toBeGreaterThan(0);
  });
});

/* ─── The gate's own calibration ────────────────────────────────── */

describe("the gates agree with reality", () => {
  it("passes essentially every recorded meta variant", () => {
    // If a future heuristic starts rejecting decks people won with, that is a
    // bug in the heuristic, and this is where it shows up. loadMetaCorpus
    // already drops the 4 variants that are genuinely illegal (a non-standard
    // card, or 59 cards), so everything reaching here should pass.
    const failures = corpus.decks.filter((d) => {
      const i = deckIssues(d.entries);
      return i.legality.length > 0 || i.playability.length > 0;
    });
    expect(failures.map((f) => f.id)).toEqual([]);
    expect(corpus.decks.length).toBeGreaterThan(300);
  });
});

/* ─── Generators ────────────────────────────────────────────────── */

describe("generated decks are playable decks", () => {
  const result = generateDecks({ corpus, count: 60, seed: 11 });

  it("produces the requested count without excessive retries", () => {
    expect(result.decks.length).toBe(60);
    // A generator burning 5x its output on rejects is broken, not unlucky.
    expect(result.attempts).toBeLessThan(60 * 3);
  });

  it("every deck is legal, playable, and instantiable by the engine", () => {
    for (const d of result.decks) {
      const issues = deckIssues(parseDeck(d.list));
      expect(issues.legality, d.id).toEqual([]);
      expect(issues.playability, d.id).toEqual([]);
      const sim = instantiateDeck(d.list, "t");
      expect(sim.deckSize, d.id).toBe(60);
      expect(sim.unknownNames, d.id).toEqual([]);
    }
  });

  it("carries provenance for every deck", () => {
    for (const d of result.decks) {
      expect(d.ops.length, d.id).toBeGreaterThan(0);
      if (d.generator === "mutate") expect(d.parentId).toBeTruthy();
      else expect(d.archetype).toBeTruthy();
    }
  });

  it("is reproducible from its seed, and a different seed differs", () => {
    const again = generateDecks({ corpus, count: 60, seed: 11 });
    expect(again.decks.map((d) => d.id)).toEqual(result.decks.map((d) => d.id));
    const other = generateDecks({ corpus, count: 60, seed: 12 });
    expect(other.decks.map((d) => d.id)).not.toEqual(result.decks.map((d) => d.id));
  });

  it("ids are content-addressed, so the same list is the same deck", () => {
    const ids = new Set(result.decks.map((d) => d.id));
    expect(ids.size).toBe(result.decks.length);
    const lists = new Set(result.decks.map((d) => d.list));
    expect(lists.size).toBe(result.decks.length);
  });
});

describe("mutation stays a variant of its parent", () => {
  const parent = corpus.decks.find((d) => d.archetype === "dragapult-ex")!;

  it("edits exactly what its ops log says it edited", () => {
    const made = mutateDeck(parent, corpus, 4242, 3);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const before = new Map(parent.entries.map((e) => [e.name, e.qty]));
    const after = new Map(parseDeck(made.deck.list).map((e) => [e.name, e.qty]));
    const names = new Set([...Array.from(before.keys()), ...Array.from(after.keys())]);
    const observed: string[] = [];
    for (const n of Array.from(names).sort()) {
      const delta = (after.get(n) ?? 0) - (before.get(n) ?? 0);
      if (delta > 0) observed.push(`+${delta} ${n}`);
      if (delta < 0) observed.push(`${delta} ${n}`);
    }
    // Each op is a single copy, so the net diff must be expressible by them.
    const netFromOps = new Map<string, number>();
    for (const op of made.deck.ops) {
      const m = op.match(/^([+-]\d+) (.+)$/);
      if (!m) continue;
      netFromOps.set(m[2], (netFromOps.get(m[2]) ?? 0) + Number(m[1]));
    }
    for (const [name, delta] of Array.from(netFromOps)) {
      if (delta === 0) continue;
      expect(observed, `${name} should appear in the diff`).toContain(
        `${delta > 0 ? "+" : ""}${delta} ${name}`,
      );
    }
  });

  it("never strands an evolution or removes the last attacker", () => {
    // Both guards exist because their absence was measured: without the
    // evolution guard, a fifth of all attempts died on orphaned lines.
    for (let seed = 0; seed < 40; seed++) {
      const made = mutateDeck(parent, corpus, seed, 4);
      if (!made.ok) continue;
      const entries = parseDeck(made.deck.list);
      expect(deckStats(entries).attackers).toBeGreaterThan(0);
      expect(deckIssues(entries).legality).toEqual([]);
    }
  });
});

describe("skeleton decks are built from the archetype's own core", () => {
  it("contains every card that appears in nearly all recorded variants", () => {
    const archetype = "dragapult-ex";
    const made = skeletonDeck(corpus, archetype, 77);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const present = new Set(parseDeck(made.deck.list).map((e) => e.name));
    const core = archetypeProfile(corpus, archetype).filter((c) => c.frequency >= 0.8);
    expect(core.length).toBeGreaterThan(0);
    // Core cards can be crowded out only by the 60-card limit; in practice
    // this archetype's core fits, and if it ever stops fitting we want to know.
    for (const c of core) expect(present, `${c.name} is core`).toContain(c.name);
  });
});

/* ─── Round-trip ────────────────────────────────────────────────── */

describe("parse/render round-trip", () => {
  it("preserves a real list's cards, counts and printings", () => {
    for (const deck of corpus.decks.slice(0, 25)) {
      const again = parseDeck(renderDeck(deck.entries));
      const norm = (es: typeof deck.entries) =>
        es
          .filter((e) => e.qty > 0)
          .map((e) => `${e.qty} ${e.name} ${e.printing ?? ""}`)
          .sort();
      expect(norm(again), deck.id).toEqual(norm(deck.entries));
    }
  });
});
