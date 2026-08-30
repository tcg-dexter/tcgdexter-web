import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReplayPayload } from "@/lib/replay/frames";
import { buildBeats, indexBeats, type Beat } from "./beats";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "battle-log", "fixtures", name), "utf8");
}

const EXAMPLE = fixture("example-1.txt");

/**
 * Every fixture, with the handle each is normalized to (the same ones
 * frames.test.ts uses).
 *
 * The coverage suite below walks all three. It used to walk only example-1,
 * and that let sixteen `effect_activated` beats sit on the generic fallback
 * in example-3 while the test reported full coverage — the exact failure the
 * test exists to catch, hidden by the fixture it happened not to look at.
 */
const ALL_FIXTURES: { name: string; handle: string }[] = [
  { name: "example-1.txt", handle: "MoonSheikah" },
  { name: "example-2-verbose.txt", handle: "a11father" },
  { name: "example-3-same-name-attach.txt", handle: "Nnova12" },
];

const HANDLE = "MoonSheikah";
const beats = buildBeats(EXAMPLE, HANDLE);
const payload = buildReplayPayload("m1", EXAMPLE, HANDLE);

function ofKind<K extends Beat["kind"]>(kind: K) {
  return beats.filter((b): b is Extract<Beat, { kind: K }> => b.kind === kind);
}

// The whole design rests on beats joining to frames by actionIndex. If that
// ever drifts — a different parse, a different normalization, an engine that
// emits events for actions frames skip — the board would choreograph the
// wrong moment, silently, on every replay.
describe("beats ↔ frames alignment", () => {
  it("emits one beat per action index, no duplicates", () => {
    const indices = beats.map((b) => b.actionIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("covers every action index the frame stream references", () => {
    const byIndex = indexBeats(beats);
    // Frame 0 is the pre-action initial state and has no action behind it.
    const frameIndices = Array.from(
      new Set(payload.frames.map((f) => f.actionIndex)),
    ).filter((i) => i >= 0);
    for (const i of frameIndices) {
      expect(byIndex.has(i), `no beat for actionIndex ${i}`).toBe(true);
    }
  });

  it("agrees with the frame's own actor and summary", () => {
    const byIndex = indexBeats(beats);
    for (const f of payload.frames) {
      const beat = byIndex.get(f.actionIndex);
      if (!beat) continue;
      expect(beat.summary).toBe(f.summary);
      expect(beat.actor).toBe(f.actor);
    }
  });
});

// Attacks and knockouts are the beats the whole 2.0 effort exists to
// dramatize. Each field below is one the choreographer reads directly, so a
// parser or reducer change that stops populating one should fail here rather
// than quietly degrade an attack into a shrug.
describe("climax beats carry what the choreographer needs", () => {
  const attacks = ofKind("attack");
  const kos = ofKind("knock_out");

  it("is not a vacuous guard — the fixture contains attacks and knockouts", () => {
    expect(attacks.length).toBeGreaterThan(0);
    expect(kos.length).toBeGreaterThan(0);
  });

  it("gives every attack an attacker, a defender and a damage number", () => {
    for (const a of attacks) {
      expect(a.attacker).not.toBe("");
      expect(a.defender).not.toBe("");
      expect(Number.isFinite(a.damage)).toBe(true);
      expect(a.weight).toBe("climax");
    }
  });

  it("names the knocked-out Pokémon, and its slot only when that is known", () => {
    for (const ko of kos) {
      expect(ko.pokemon).not.toBe("");
      // null is a legitimate answer, not a gap. The parser's knockout line
      // never states a slot, so `where` comes from the engine finding the
      // Pokémon in play — and it can't, for one it never tracked into play
      // (see the bulk-bench-line case above). A null means "don't constrain
      // by position"; defaulting it to "active" would confidently pin a
      // benched knockout's debris to the wrong card.
      expect([null, "active", "bench"]).toContain(ko.where);
      expect(ko.weight).toBe("climax");
    }
  });

  it("mostly resolves a knocked-out Pokémon against the frame before the KO", () => {
    // The KO event carries a name but no engine instance id, and by the KO
    // frame the Pokémon is already in the discard — so the director has to
    // look it up in the frame BEFORE the KO to find something to animate.
    //
    // That lookup can legitimately fail. TCG Live writes some bench arrivals
    // as one bulk line ("• Staryu, Froakie") that the parser doesn't split
    // into per-card actions, so the engine never tracks those Pokémon into
    // play and raises ko_target_missing when one is knocked out. example-1
    // contains exactly that case. Fixing it is a parser change, well outside
    // Replay 2.0 — so the contract here is that SOME KOs resolve (the
    // director's anchored path is real) and that the rest are detectable
    // rather than silently animating nothing (its mat-centre fallback is
    // real too). If this ever flips to all-resolvable, the fallback has
    // stopped being exercised and should be re-justified, not deleted.
    const frames = payload.frames;
    const resolution = kos.map((ko) => {
      const at = frames.findIndex((f) => f.actionIndex === ko.actionIndex);
      if (at <= 0) return false;
      const prev = frames[at - 1];
      const side = ko.actor === "player" ? prev.player : prev.opponent;
      const inPlay = [side.active, ...side.bench].filter(
        (p): p is NonNullable<typeof p> => p != null,
      );
      return inPlay.some((p) => p.name === ko.pokemon);
    });
    expect(resolution.some(Boolean), "no KO resolves to a card on the board").toBe(
      true,
    );
    // Every KO names something, resolvable or not, so the fallback always
    // has a label to put on screen.
    for (const ko of kos) expect(ko.pokemon).not.toBe("");
  });
});

describe("board beats carry their targets", () => {
  it("types every attached energy", () => {
    const attaches = ofKind("attach_energy");
    expect(attaches.length).toBeGreaterThan(0);
    for (const a of attaches) {
      expect(a.energy).not.toBe("");
      expect(a.energyType).not.toBe("");
      // Effect-driven attachments come in runs and must not each hold the
      // board the way a manual once-per-turn drop does.
      expect(a.weight).toBe(a.viaEffect ? "ambient" : "normal");
    }
  });

  it("names both ends of an evolution", () => {
    const evolves = ofKind("evolve");
    expect(evolves.length).toBeGreaterThan(0);
    for (const e of evolves) {
      expect(e.from).not.toBe("");
      expect(e.to).not.toBe("");
      expect(e.from).not.toBe(e.to);
    }
  });

  it("classifies trainer plays into item / supporter / tool / stadium", () => {
    const trainers = ofKind("play_trainer");
    expect(trainers.length).toBeGreaterThan(0);
    for (const t of trainers) {
      expect(t.card).not.toBe("");
      expect(["item", "supporter", "tool", "stadium"]).toContain(t.subtype);
    }
  });
});

// A beat that falls through to "generic" gets paced but not choreographed.
// That's the intended landing spot for future parser additions, not for the
// action types the breadth pass is supposed to have covered.
// The move name plate is driven entirely by these two fields. If a parser
// change stopped populating them the plate wouldn't break — it would just
// quietly never appear, which is the kind of regression nobody files a bug
// for and nobody notices for a month.
describe("moves are named", () => {
  it("gives every attack and ability a label, in any fixture", () => {
    for (const { name, handle } of ALL_FIXTURES) {
      const all = buildBeats(fixture(name), handle);
      const attacks = all.filter((b) => b.kind === "attack");
      const abilities = all.filter((b) => b.kind === "ability");
      expect(attacks.length + abilities.length, `${name} has no moves`).toBeGreaterThan(0);
      for (const b of attacks) {
        expect((b as Extract<Beat, { kind: "attack" }>).attack, `${name}: unnamed attack`).toBeTruthy();
      }
      for (const b of abilities) {
        expect((b as Extract<Beat, { kind: "ability" }>).ability, `${name}: unnamed ability`).toBeTruthy();
      }
    }
  });
});

describe("choreography coverage", () => {
  it("leaves no known action type on the generic fallback, in any fixture", () => {
    for (const { name, handle } of ALL_FIXTURES) {
      const leftovers = buildBeats(fixture(name), handle)
        .filter((b) => b.kind === "generic")
        .map((b) => (b as Extract<Beat, { kind: "generic" }>).actionKind);
      expect(Array.from(new Set(leftovers)), `unmapped in ${name}`).toEqual([]);
    }
  });
});
