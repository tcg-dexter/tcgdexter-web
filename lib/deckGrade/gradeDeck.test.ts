import { describe, expect, it } from "vitest";
import { gradeDeck } from "./gradeDeck";
import { classifyStyle } from "./classifyStyle";
import {
  scoreEnergy,
  scoreEvolution,
  scoreSetup,
  scoreToolbox,
} from "./axes";
import type { GradeCard } from "./types";

/* ─── Fixture builders ────────────────────────────────────────── */

function card(p: Partial<GradeCard> & { name: string }): GradeCard {
  return {
    name: p.name,
    qty: p.qty ?? 1,
    supertype: p.supertype ?? "Trainer",
    subtypes: p.subtypes ?? [],
    types: p.types ?? [],
    hp: p.hp ?? null,
    retreatCost: p.retreatCost ?? 0,
    evolvesFrom: p.evolvesFrom ?? null,
    attacks: p.attacks ?? [],
    effectText: p.effectText ?? "",
    isBasicEnergy: p.isBasicEnergy ?? false,
    isSpecialEnergy: p.isSpecialEnergy ?? false,
    energyProvides: p.energyProvides ?? [],
  };
}

const basicEnergy = (type: string, qty: number): GradeCard =>
  card({
    name: `Basic ${type} Energy`,
    qty,
    supertype: "Energy",
    subtypes: ["Basic"],
    isBasicEnergy: true,
    energyProvides: [type],
  });

const fireAttacker = (over: Partial<GradeCard> = {}): GradeCard =>
  card({
    name: "Flarebeast",
    qty: 4,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    types: ["Fire"],
    hp: 180,
    attacks: [{ cost: ["Fire", "Fire"], damage: "180" }],
    ...over,
  });

/* ─── Energy System ───────────────────────────────────────────── */

describe("energy axis", () => {
  it("flags energy that powers no attacker AND attackers with no energy", () => {
    const deck = [fireAttacker(), basicEnergy("Water", 8)];
    const res = scoreEnergy(deck, "aggro");
    expect(res.status).toBe("weak");
    expect(res.finding).toMatch(/Fire/);
    expect(res.finding).toMatch(/no matching Energy/i);
    expect(res.lever).toBeTruthy();
  });

  it("passes when energy types match the attackers", () => {
    const deck = [fireAttacker(), basicEnergy("Fire", 8)];
    const res = scoreEnergy(deck, "aggro");
    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.status).toBe("good");
  });

  it("is style-aware: 13 energy is fine for control, heavy for aggro", () => {
    const deck = [fireAttacker(), basicEnergy("Fire", 13)];
    const aggro = scoreEnergy(deck, "aggro");
    const control = scoreEnergy(deck, "control");
    expect(control.score).toBeGreaterThan(aggro.score);
  });
});

/* ─── Setup & Consistency ─────────────────────────────────────── */

describe("setup axis", () => {
  it("penalizes a thin draw engine (search is fine, draw is not)", () => {
    const deck = [
      fireAttacker(),
      basicEnergy("Fire", 8),
      card({ name: "Nest Ball", qty: 8, subtypes: ["Item"] }),
      card({ name: "Professor's Research", qty: 1, subtypes: ["Supporter"] }),
    ];
    const res = scoreSetup(deck, "aggro");
    expect(res.status).toBe("weak");
    expect(res.finding).toMatch(/draw Supporters|Supporter/i);
  });

  it("rewards a healthy supporter + search suite", () => {
    const deck = [
      fireAttacker(),
      basicEnergy("Fire", 8),
      card({ name: "Professor's Research", qty: 4, subtypes: ["Supporter"] }),
      card({ name: "Iono", qty: 4, subtypes: ["Supporter"] }),
      card({ name: "Nest Ball", qty: 4, subtypes: ["Item"] }),
      card({ name: "Ultra Ball", qty: 4, subtypes: ["Item"] }),
    ];
    const res = scoreSetup(deck, "aggro");
    expect(res.score).toBeGreaterThanOrEqual(70);
  });
});

/* ─── Toolbox ─────────────────────────────────────────────────── */

describe("toolbox axis", () => {
  it("dings a deck with no gust and calls it out", () => {
    const deck = [
      fireAttacker(),
      card({ name: "Professor's Research", qty: 4, subtypes: ["Supporter"] }),
      card({ name: "Nest Ball", qty: 4, subtypes: ["Item"] }),
    ];
    const res = scoreToolbox(deck, "aggro");
    expect(res.finding).toMatch(/gust/i);
    expect(res.score).toBeLessThan(80);
  });

  it("is satisfied once gust is present", () => {
    const deck = [
      fireAttacker(),
      card({ name: "Professor's Research", qty: 4, subtypes: ["Supporter"] }),
      card({ name: "Nest Ball", qty: 4, subtypes: ["Item"] }),
      card({ name: "Boss's Orders", qty: 2, subtypes: ["Supporter"] }),
    ];
    const res = scoreToolbox(deck, "aggro");
    expect(res.score).toBe(100);
  });
});

/* ─── Evolution Integrity ─────────────────────────────────────── */

describe("evolution axis", () => {
  it("flags a Stage 2 with no pre-evolution and no Rare Candy", () => {
    const deck = [
      card({ name: "Smallmon", qty: 8, supertype: "Pokémon", subtypes: ["Basic"], hp: 70 }),
      card({
        name: "Bigmon",
        qty: 2,
        supertype: "Pokémon",
        subtypes: ["Stage 2"],
        evolvesFrom: "Midmon",
        hp: 330,
        attacks: [{ cost: ["Fire", "Fire"], damage: "330" }],
      }),
    ];
    const res = scoreEvolution(deck);
    expect(res.finding).toMatch(/Rare Candy/);
    expect(res.score).toBeLessThan(80);
  });

  it("is a no-op for all-Basic decks", () => {
    const res = scoreEvolution([fireAttacker(), basicEnergy("Fire", 8)]);
    expect(res.score).toBe(100);
    expect(res.status).toBe("good");
  });
});

/* ─── Style classification ────────────────────────────────────── */

describe("classifyStyle", () => {
  it("reads a fast all-Basic beater as aggro", () => {
    const deck = [
      fireAttacker(),
      basicEnergy("Fire", 8),
      card({ name: "Nest Ball", qty: 4, subtypes: ["Item"] }),
    ];
    expect(classifyStyle(deck).style).toBe("aggro");
  });

  it("reads a disruption-heavy low-damage deck as control", () => {
    const deck = [
      fireAttacker({ attacks: [{ cost: ["Fire"], damage: "60" }], hp: 320 }),
      basicEnergy("Fire", 10),
      card({ name: "Iono", qty: 4, subtypes: ["Supporter"] }),
      card({ name: "Judge", qty: 2, subtypes: ["Supporter"] }),
      card({ name: "Super Rod", qty: 2, subtypes: ["Item"] }),
    ];
    expect(classifyStyle(deck).style).toBe("control");
  });
});

/* ─── Orchestrator ────────────────────────────────────────────── */

describe("gradeDeck", () => {
  const deck: GradeCard[] = [
    fireAttacker(),
    basicEnergy("Fire", 9),
    card({ name: "Professor's Research", qty: 4, subtypes: ["Supporter"] }),
    card({ name: "Iono", qty: 3, subtypes: ["Supporter"] }),
    card({ name: "Nest Ball", qty: 4, subtypes: ["Item"] }),
    card({ name: "Ultra Ball", qty: 4, subtypes: ["Item"] }),
    card({ name: "Boss's Orders", qty: 2, subtypes: ["Supporter"] }),
  ];

  it("returns a style, five scored axes + one info axis, and a letter grade", () => {
    const g = gradeDeck({
      cards: deck,
      legality: { legal: true, rotatingCount: 0 },
      meta: { archetypeName: "Flarebeast", rank: 3, conversionRate: 0.18 },
    });
    expect(g.axes).toHaveLength(6);
    expect(g.axes.filter((a) => a.weight > 0)).toHaveLength(5);
    expect("SABCD").toContain(g.grade);
    expect(g.total).toBeGreaterThan(0);
    expect(g.total).toBeLessThanOrEqual(100);
  });

  it("keeps legality as a separate gate, not folded into the total", () => {
    const base = { cards: deck, meta: undefined };
    const legal = gradeDeck({ ...base, legality: { legal: true, rotatingCount: 0 } });
    const illegal = gradeDeck({ ...base, legality: { legal: false, rotatingCount: 3 } });
    expect(legal.total).toBe(illegal.total);
    expect(illegal.legality.legal).toBe(false);
  });

  it("meta axis is informational (weight 0) and surfaces the archetype", () => {
    const g = gradeDeck({
      cards: deck,
      legality: { legal: true, rotatingCount: 0 },
      meta: { archetypeName: "Flarebeast", rank: 3, conversionRate: 0.18 },
    });
    const meta = g.axes.find((a) => a.key === "meta")!;
    expect(meta.weight).toBe(0);
    expect(meta.finding).toMatch(/Flarebeast/);
  });
});
