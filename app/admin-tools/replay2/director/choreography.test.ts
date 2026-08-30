import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBeats } from "@/lib/replay2/beats";
import { ALL_SPECS, choreographyFor, specDuration } from "./choreography";

const EXAMPLE = readFileSync(
  join(process.cwd(), "lib", "battle-log", "fixtures", "example-1.txt"),
  "utf8",
);
const beats = buildBeats(EXAMPLE, "MoonSheikah");

// The table is exhaustive by TYPE — Record<Beat["kind"], …> won't compile if a
// beat kind is added without a spec. These cover what the type can't: that
// each spec is actually playable, and that the pacing spread the whole
// rework rests on is real rather than a table of identical numbers.
describe("choreography specs are well formed", () => {
  it("gives every spec positive phase durations", () => {
    for (const spec of ALL_SPECS) {
      expect(spec.phases.length).toBeGreaterThan(0);
      for (const p of spec.phases) expect(p.ms).toBeGreaterThan(0);
    }
  });

  it("ends every spec at rest", () => {
    // The director holds the last phase until the frame advances, and a beat
    // parked on "impact" would leave a card mid-jolt for the rest of its
    // screen time.
    for (const spec of ALL_SPECS) {
      expect(spec.phases[spec.phases.length - 1].phase).toBe("settle");
    }
  });

  it("never repeats a phase back-to-back", () => {
    // The director sets state per phase step; two identical adjacent phases
    // are a silent no-op that just pads the beat, which is what the ms field
    // is for.
    for (const spec of ALL_SPECS) {
      for (let i = 1; i < spec.phases.length; i++) {
        expect(spec.phases[i].phase).not.toBe(spec.phases[i - 1].phase);
      }
    }
  });
});

describe("pacing actually varies", () => {
  it("resolves a spec for every beat the fixture produces", () => {
    for (const beat of beats) {
      const spec = choreographyFor(beat);
      expect(specDuration(spec), `no duration for ${beat.kind}`).toBeGreaterThan(0);
    }
  });

  it("holds a climax far longer than ambient bookkeeping", () => {
    // The entire premise of replacing v1's fixed interval. If this ratio ever
    // collapses toward 1, the replay is back to being a metronome and every
    // layer built on top of the director is decorating a flat surface.
    //
    // Both beats are asserted present first. `find` returning undefined makes
    // choreographyFor fall through to its no-beat default, which silently
    // turns this into a comparison of two numbers neither of which is under
    // test — it read as a near-pass (3.95) rather than an error.
    const turnEnd = beats.find((b) => b.kind === "turn_end");
    const attack = beats.find((b) => b.kind === "attack");
    expect(turnEnd, "fixture has no ambient beat to compare against").toBeDefined();
    expect(attack, "fixture has no climax beat to compare against").toBeDefined();
    const ratio = specDuration(choreographyFor(attack!)) / specDuration(choreographyFor(turnEnd!));
    expect(ratio).toBeGreaterThan(4);
  });

  it("cuts, rather than performs, on a jump", () => {
    const attack = beats.find((b) => b.kind === "attack")!;
    const jumped = choreographyFor(attack, { instant: true });
    expect(jumped.phases).toEqual([{ phase: "settle", ms: 90 }]);
    expect(specDuration(jumped)).toBeLessThan(
      specDuration(choreographyFor(attack)) / 8,
    );
  });

  it("gives a continuation frame its own short beat, not the action's", () => {
    // Discard-then-draw expands to three frames sharing one action; running
    // the full beat on each would triple an Ultra Ball.
    const trainer = beats.find((b) => b.kind === "play_trainer")!;
    expect(specDuration(choreographyFor(trainer, { continuation: true }))).toBe(380);
  });
});
