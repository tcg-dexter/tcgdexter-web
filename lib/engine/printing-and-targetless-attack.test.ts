import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { buildReplayPayload } from "@/lib/replay/frames";
import { isAttackName, lookupCard, lookupPrintingByMoves } from "./catalog";
import { parseBattleLogWithCatalog } from "./parseWithCatalog";

// Real match yourkoreandad vs papaolafar (battle Ap3s-fqZ), exported in the
// STANDARD TCG Live format — every card is named by name alone, with none of
// the verbose export's "(sv5_69) Bronzong" id prefixes. Two bugs surfaced on
// it, both downstream of that:
//
//   1. Wrong art. With no id to resolve, the catalog fell back to "newest
//      regulation mark wins", handing back Bronzong me5-64 (Gentle Slap /
//      Metal Block). The card actually being played is sv5-69, and the log
//      says so eight times over: "papaolafar's Bronzong used Evolution
//      Jammer".
//
//   2. "?" where the player's archetype belongs. yourkoreandad's only
//      attacker was Fezandipiti ex using Cruel Arrow, which the log writes
//      targetlessly — "<handle>'s <Pokémon> used <move>." with the damage on
//      the following bullet — i.e. character-for-character the shape of an
//      ability. It parsed as `ability_used`, so the side had zero attacks,
//      the top-damage attacker was null, and the matchup row rendered "?".
const LOG = readFileSync(
  join(__dirname, "fixtures", "yourkoreandad-papaolafar.txt"),
  "utf8",
);

const parsed = normalizePerspective(parseBattleLogWithCatalog(LOG), "yourkoreandad");
const payload = buildReplayPayload("test", LOG, "yourkoreandad");

describe("printing resolution from the moves the log saw", () => {
  it("picks the Bronzong that actually has Evolution Jammer", () => {
    // The name-only fallback that used to drive this is still wrong — the
    // point is that we no longer rely on it.
    expect(lookupCard("Bronzong")?.set_id).toBe("me5");

    const hit = lookupPrintingByMoves("Bronzong", ["Evolution Jammer"]);
    expect(hit?.set_id).toBe("sv5");
    expect(hit?.number).toBe("69");
    expect(hit?.attacks.map((a) => a.name)).toContain("Evolution Jammer");
  });

  it("renders the opponent's Bronzong from that printing on the board", () => {
    const bronzongs = payload.frames.flatMap((f) =>
      [f.opponent.active, ...f.opponent.bench].filter(
        (mon): mon is NonNullable<typeof mon> => mon?.name === "Bronzong",
      ),
    );
    expect(bronzongs.length).toBeGreaterThan(0);
    for (const mon of bronzongs) {
      expect(mon.imageUrl).toContain("sv5");
      expect(mon.imageUrl).not.toContain("me5");
    }
  });

  it("declines to guess when the moves fit no single printing", () => {
    expect(lookupPrintingByMoves("Bronzong", ["Not A Real Move"])).toBeNull();
    expect(lookupPrintingByMoves("Bronzong", [])).toBeNull();
  });
});

describe("targetless attacks are attacks, not abilities", () => {
  it("classifies by the catalog, leaving real abilities alone", () => {
    expect(isAttackName("Fezandipiti ex", "Cruel Arrow")).toBe(true);
    expect(isAttackName("Fezandipiti ex", "Flip the Script")).toBe(false);
    // Same "used X." shape, genuinely abilities — these must not flip.
    expect(isAttackName("Meowth ex", "Last-Ditch Catch")).toBe(false);
    expect(isAttackName("Drakloak", "Recon Directive")).toBe(false);
    expect(isAttackName("Munkidori", "Adrena-Brain")).toBe(false);
    expect(isAttackName("Dusknoir", "Cursed Blast")).toBe(false);
    // Unknown names stay unclassified rather than guessing.
    expect(isAttackName("Not A Pokemon", "Cruel Arrow")).toBe(false);
  });

  it("parses the player's three Cruel Arrows as attacks carrying their damage", () => {
    const attacks = parsed.actions.filter(
      (a) => a.action_type === "attack" && a.actor === "player",
    );
    expect(attacks).toHaveLength(3);
    for (const a of attacks) {
      const p = a.payload as Record<string, unknown>;
      expect(p.attacker).toBe("Fezandipiti ex");
      expect(p.attack_name).toBe("Cruel Arrow");
      expect(p.targetless).toBe(true);
      expect(p.damage).toBe(100);
      // The damage rides on splash_damage so it can reach a BENCHED target,
      // which is the whole reason the attack is targetless.
      expect(p.splash_damage).toHaveLength(1);
    }
  });

  it("leaves the classification alone when no catalog is lent in", () => {
    // The bare parser also runs in the browser (the import preview), where
    // the 15 MB card database must not be bundled. Without the catalog it
    // keeps its old behavior rather than guessing — safe, because the
    // preview's `summarize` reads none of the affected action types.
    const bare = normalizePerspective(parseBattleLog(LOG), "yourkoreandad");
    expect(bare.actions.filter((a) => a.action_type === "attack" && a.actor === "player")).toHaveLength(0);
    expect(
      bare.actions.filter(
        (a) =>
          a.action_type === "ability_used" &&
          (a.payload as Record<string, unknown>).ability_name === "Cruel Arrow",
      ),
    ).toHaveLength(3);
  });

  it("names the player's real attacker instead of '?'", () => {
    // Was null before the reclassification — the side had no parsed attack
    // at all — which the matchup row rendered as "?".
    expect(payload.playerPrimaryName).toBe("Fezandipiti ex");
    // The opponent's side already worked: Mega Lopunny ex's single Gale
    // Thrust (230) outweighs Bronzong's seven Evolution Jammers (7 x 30 =
    // 210). Asserted so the reclassification can't quietly disturb it.
    expect(payload.opponentPrimaryName).toBe("Mega Lopunny ex");
  });

  it("applies each targetless hit exactly once, to the right benched target", () => {
    // Latias ex sits on the BENCH the whole game, so the reducer's headline
    // "damage the opposing Active" path can never reach it — only the splash
    // entries can. It takes 100 from the second Cruel Arrow, 100 from the
    // third, then 30 from Munkidori's counter move, and is knocked out.
    // Applying both the headline damage and the splash would read 200 / 400.
    const latiasDamage = payload.frames
      .map(
        (f) =>
          [f.opponent.active, ...f.opponent.bench].find(
            (mon) => mon?.name === "Latias ex",
          )?.damage ?? null,
      )
      .filter((d): d is number => d !== null);
    const seen = Array.from(new Set(latiasDamage)).sort((a, b) => a - b);
    expect(seen).toEqual([0, 100, 200, 230]);
  });
});
