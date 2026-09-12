import { describe, it, expect } from "vitest";

import { isCurrentStandard } from "@/lib/engine/catalog";
import { loadMetaCorpus } from "@/lib/ml/deckGen/corpus";
import {
  META_PRIOR_FIELDS,
  archetypePosterior,
  expectedUnseen,
  metaPrior,
  metaPriorVector,
  priorCorpusSize,
  topArchetypes,
} from "./metaPrior";

describe("archetype posterior", () => {
  it("names the deck from one signature Pokémon", () => {
    // A human pilot does this instantly and every model we have trained is
    // blind to it. N's Zorua appears in essentially one archetype.
    const top = topArchetypes(["N's Zorua"], 1)[0];
    expect(top.id).toBe("n-s-zoroark-ex");
    expect(top.p).toBeGreaterThan(0.25);
  });

  it("sharpens as more of the deck is revealed", () => {
    const one = metaPrior(["N's Zorua"]);
    const two = metaPrior(["N's Zorua", "N's Zoroark ex"]);
    expect(two.confidence).toBeGreaterThan(one.confidence);
    expect(two.entropy).toBeLessThan(one.entropy);
  });

  it("stays humble when the evidence is a universal staple", () => {
    // Reading one Ultra Ball is not evidence. If the prior got confident here
    // it would be confidently wrong for most of every game, since staples are
    // what a board reveals first.
    const p = metaPrior(["Ultra Ball"]);
    expect(p.entropy).toBeGreaterThan(0.9);
    expect(p.evidence).toBeLessThan(0.2);
    expect(p.confidence).toBeLessThan(0.15);
  });

  it("scores a signature card as far more informative than a staple", () => {
    expect(metaPrior(["N's Zorua"]).evidence).toBeGreaterThan(
      metaPrior(["Ultra Ball"]).evidence * 5,
    );
  });

  it("is a probability distribution", () => {
    const post = archetypePosterior(["Dreepy"]);
    const sum = Array.from(post.values()).reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const p of Array.from(post.values())) expect(p).toBeGreaterThanOrEqual(0);
  });

  it("never assigns zero probability to an archetype", () => {
    // Real lists carry one-ofs the recorded variants missed. A hard zero from
    // one off-list tech card would be a confident wrong answer, and the
    // archetype could never be recovered no matter what else we see.
    const post = archetypePosterior(["N's Zorua", "Ultra Ball", "Boss's Orders"]);
    for (const p of Array.from(post.values())) expect(p).toBeGreaterThan(0);
  });

  it("falls back to a flat, zeroed prior when nothing is known", () => {
    const p = metaPrior([]);
    expect(p.observed).toBe(0);
    expect(p.confidence).toBe(0);
    expect(metaPriorVector([]).length).toBe(META_PRIOR_FIELDS.length);
  });

  it("ignores cards outside the vocabulary rather than throwing", () => {
    const p = metaPrior(["Not A Real Card", "N's Zorua"]);
    expect(p.observed).toBe(1);
  });
});

describe("the prior is built only from format-legal cards", () => {
  it("has no rotated card anywhere in its vocabulary", () => {
    // The whole point of the legality work. If a rotated staple entered the
    // prior, the model would "expect" cards the opponent cannot legally run.
    for (const d of loadMetaCorpus()) {
      for (const e of d.entries) expect(isCurrentStandard(e.name)).toBe(true);
    }
    expect(priorCorpusSize().archetypes).toBe(30);
  });

  it("expects unseen cards that are legal and not already revealed", () => {
    const revealed = ["N's Zorua", "N's Zoroark ex"];
    const unseen = expectedUnseen(revealed, 10);
    expect(unseen.length).toBeGreaterThan(0);
    for (const u of unseen) {
      expect(revealed).not.toContain(u.name);
      expect(isCurrentStandard(u.name)).toBe(true);
      expect(u.qty).toBeGreaterThan(0);
    }
    // Ranked by expected remaining copies.
    for (let i = 1; i < unseen.length; i++) {
      expect(unseen[i - 1].qty).toBeGreaterThanOrEqual(unseen[i].qty);
    }
  });
});
