import { describe, expect, it } from "vitest";
import {
  gutDeckList,
  headlineCard,
  judgeCompetence,
  type CompetenceProbe,
} from "./pilotCompetence";

const probe = (deltaPoints: number): CompetenceProbe => ({
  base: 0.6,
  gutted: 0.6 + deltaPoints / 100,
  deltaPoints,
});

describe("judgeCompetence", () => {
  it("passes a deck the pilot clearly uses", () => {
    // Dragapult's measured numbers.
    const v = judgeCompetence([probe(-28.1), probe(-21.9)]);
    expect(v.competent).toBe(true);
    expect(v.consistent).toBe(true);
  });

  it("REJECTS a deck whose seeds disagree, even if the mean looks fine", () => {
    // N's Zoroark's measured numbers: -5.2 and +13.5. The mean is +4.2, so a
    // mean-only rule would call this "the key card HURTS you" with
    // confidence, which is both wrong and actively harmful as advice. Sign
    // agreement is why two seeds are run at all.
    const v = judgeCompetence([probe(-5.2), probe(13.5)]);
    expect(v.competent).toBe(false);
    expect(v.consistent).toBe(false);
    expect(v.reason).toMatch(/disagree/);
  });

  it("rejects a drop too small to be meaningful", () => {
    const v = judgeCompetence([probe(-1.2), probe(-0.4)]);
    expect(v.competent).toBe(false);
    expect(v.consistent).toBe(true);
  });

  it("refuses to judge on a single seed", () => {
    expect(judgeCompetence([probe(-30)]).competent).toBe(false);
  });
});

describe("gutDeckList", () => {
  const list = ["4 Dragapult ex DRI 130", "3 Drakloak TWM 129", "8 Basic Psychic Energy"].join("\n");

  it("replaces every copy, preserving the 60-card count", () => {
    const g = gutDeckList(list, "Dragapult ex");
    expect(g).toContain("4 Basic Fighting Energy");
    expect(g).not.toContain("Dragapult ex");
    expect(g).toContain("3 Drakloak TWM 129");
  });

  it("matches by prefix so set codes don't defeat it", () => {
    expect(gutDeckList(list, "Drakloak")).not.toContain("Drakloak");
  });

  it("leaves the list untouched when the card isn't present", () => {
    expect(gutDeckList(list, "Pikachu ex")).toBe(list);
  });
});

describe("headlineCard", () => {
  it("picks the highest-HP attacker, ignoring set codes", () => {
    const list = ["4 Dragapult ex DRI 130", "3 Drakloak TWM 129", "8 Basic Psychic Energy"].join("\n");
    const hp = (n: string) => ({ "Dragapult ex": 320, Drakloak: 90 }[n] ?? null);
    expect(headlineCard(list, hp)).toBe("Dragapult ex");
  });

  it("returns null when nothing in the list has HP", () => {
    expect(headlineCard("8 Basic Psychic Energy", () => null)).toBeNull();
  });
});

describe("headlineCard with an archetype hint", () => {
  const list = [
    "3 Alakazam MEE 65",
    "2 Fezandipiti ex SFA 38",
    "6 Basic Psychic Energy",
  ].join("\n");
  const hp = (n: string) => ({ Alakazam: 140, "Fezandipiti ex": 210 }[n] ?? null);

  it("prefers the archetype's namesake over a beefier tech card", () => {
    // Without the hint this returns Fezandipiti ex (210 > 140) — a generic
    // tech card whose removal proves nothing about piloting Alakazam.
    expect(headlineCard(list, hp)).toBe("Fezandipiti ex");
    expect(headlineCard(list, hp, "Alakazam")).toBe("Alakazam");
  });

  it("falls back to highest HP when the hint matches nothing", () => {
    expect(headlineCard(list, hp, "Charizard")).toBe("Fezandipiti ex");
  });
});
