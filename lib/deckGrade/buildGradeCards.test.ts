import { describe, expect, it } from "vitest";
import { parseDeckListCards } from "@/lib/cardPrinting";
import { buildGradeCards } from "./buildGradeCards";
import { gradeDeck } from "./gradeDeck";

/**
 * Integration coverage over the LIVE card catalog (not fixtures) — the app
 * can't be booted in CI here, so this is where we prove the adapter reads real
 * attack costs / subtypes and that the flagship energy-match path fires on a
 * genuine printing.
 */
describe("buildGradeCards (live catalog)", () => {
  it("reads Charizard ex's Fire attack cost from real data", () => {
    const cards = parseDeckListCards(`Pokémon: 1\n1 Charizard ex\n`);
    const gc = buildGradeCards(cards);
    const zard = gc.find((c) => c.name.toLowerCase().includes("charizard"));
    expect(zard).toBeTruthy();
    expect(zard!.supertype).toBe("Pokémon");
    expect(zard!.attacks.some((a) => a.cost.includes("Fire"))).toBe(true);
  });

  it("flags a Fire attacker running only Water energy", () => {
    const cards = parseDeckListCards(
      `Pokémon: 1\n1 Charizard ex\n\nEnergy: 8\n8 Basic {W} Energy\n`,
    );
    const grade = gradeDeck({
      cards: buildGradeCards(cards),
      legality: { legal: true, rotatingCount: 0 },
    });
    expect(grade.axes).toHaveLength(6);
    expect("SABCD").toContain(grade.grade);

    const energy = grade.axes.find((a) => a.key === "energy")!;
    expect(energy.finding).toMatch(/Fire/);
    expect(energy.status).toBe("weak");
  });
});
