import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBeats, indexBeats, type Beat } from "@/lib/replay2/beats";
import { buildReplayPayload, type ReplayFrame } from "@/lib/replay/frames";
import { resolveClaim, type MatCards } from "./claim";

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "lib", "battle-log", "fixtures", name),
    "utf8",
  );
}

const FIXTURES: { name: string; handle: string }[] = [
  { name: "example-1.txt", handle: "MoonSheikah" },
  { name: "example-2-verbose.txt", handle: "a11father" },
  { name: "example-3-same-name-attach.txt", handle: "Nnova12" },
];

const EMPTY: MatCards = { active: null, bench: [] };

function matOf(frame: ReplayFrame, side: "player" | "opponent"): MatCards {
  const s = side === "player" ? frame.player : frame.opponent;
  return { active: s.active, bench: s.bench };
}

describe("an attack is claimed by the Active Pokémon only", () => {
  // The bug this exists to prevent: a benched Pokémon sharing the attacker's
  // name lit up and performed the attack alongside (or instead of) the real
  // attacker. Duplicate names on a board are completely ordinary and the log
  // identifies Pokémon by name alone, so the old name-only match had no way
  // to tell them apart.
  it("is not a vacuous guard — real logs attack with a name that is also on the bench", () => {
    let ambiguous = 0;
    for (const { name, handle } of FIXTURES) {
      const raw = fixture(name);
      const beats = indexBeats(buildBeats(raw, handle));
      const { frames } = buildReplayPayload("m", raw, handle);
      for (const f of frames) {
        const beat = beats.get(f.actionIndex);
        if (beat?.kind !== "attack") continue;
        const side = beat.actor === "player" ? f.player : f.opponent;
        if (side.bench.some((p) => p.name === beat.attacker)) ambiguous++;
      }
    }
    expect(ambiguous).toBeGreaterThan(0);
  });

  it("never claims a benched card for the attacker or the defender", () => {
    for (const { name, handle } of FIXTURES) {
      const raw = fixture(name);
      const beats = indexBeats(buildBeats(raw, handle));
      const { frames } = buildReplayPayload("m", raw, handle);
      for (const f of frames) {
        const beat = beats.get(f.actionIndex);
        if (beat?.kind !== "attack") continue;

        for (const side of ["player", "opponent"] as const) {
          const cards = matOf(f, side);
          const { actorId, targetId } = resolveClaim(beat, side, cards, EMPTY);
          const benchIds = new Set(cards.bench.map((p) => p.id));
          expect(benchIds.has(actorId ?? ""), `${name}: benched attacker`).toBe(false);
          expect(benchIds.has(targetId ?? ""), `${name}: benched defender`).toBe(false);
          // And what it does claim is genuinely the Active card.
          if (actorId) expect(actorId).toBe(cards.active?.id);
          if (targetId) expect(targetId).toBe(cards.active?.id);
        }
      }
    }
  });

  it("claims the attacker on its own mat and the defender on the other", () => {
    const raw = fixture("example-1.txt");
    const beats = indexBeats(buildBeats(raw, "MoonSheikah"));
    const { frames } = buildReplayPayload("m", raw, "MoonSheikah");
    let checked = 0;
    for (const f of frames) {
      const beat = beats.get(f.actionIndex);
      if (beat?.kind !== "attack" || beat.actor === "system") continue;
      const other = beat.actor === "player" ? "opponent" : "player";
      const own = resolveClaim(beat, beat.actor, matOf(f, beat.actor), EMPTY);
      const opp = resolveClaim(beat, other, matOf(f, other), EMPTY);
      // An attack is the one beat that reaches across the board: the actor's
      // mat supplies the attacker and never the defender, and vice versa.
      expect(own.targetId).toBeNull();
      expect(opp.actorId).toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("a subject that has already left the board", () => {
  it("resolves against the previous frame", () => {
    // A knocked-out Pokémon is in the discard by the frame that announces it,
    // so it cannot be found on the current board at all — but AnimatePresence
    // is still rendering it on its way out, and it is the only thing left
    // that knows where it stood.
    const raw = fixture("example-1.txt");
    const beats = indexBeats(buildBeats(raw, "MoonSheikah"));
    const { frames } = buildReplayPayload("m", raw, "MoonSheikah");
    let recovered = 0;
    frames.forEach((f, i) => {
      const beat = beats.get(f.actionIndex);
      if (beat?.kind !== "knock_out" || i === 0) return;
      const side = beat.actor === "player" ? "player" : "opponent";
      const now = matOf(f, side);
      const before = matOf(frames[i - 1], side);
      const withoutHistory = resolveClaim(beat, side, now, EMPTY);
      const withHistory = resolveClaim(beat, side, now, before);
      if (withoutHistory.targetId == null && withHistory.targetId != null) {
        recovered++;
      }
    });
    // Some knockouts in this fixture are of Pokémon the parser never tracked
    // into play (bulk bench lines it doesn't split), so not every one is
    // recoverable — but the mechanism has to do real work on at least one.
    expect(recovered).toBeGreaterThan(0);
  });
});

describe("duplicate names that position cannot separate", () => {
  it("claims exactly one card, mirroring the engine's own choice", () => {
    // An ability can fire from the bench and the log gives no slot, so two
    // Drakloak really are indistinguishable. The contract is not that this is
    // always right — it cannot be — but that it picks ONE, and picks the same
    // one the engine's findPokemon does (Active before Bench, first match),
    // so the card that performs is the card whose state actually changed.
    const beat = {
      actionIndex: 0,
      actor: "player",
      weight: "normal",
      summary: "",
      kind: "ability",
      source: "Drakloak",
      ability: "Recon Directive",
    } as Beat;
    const cards: MatCards = {
      active: { id: "a1", name: "Dusknoir" },
      bench: [
        { id: "b1", name: "Drakloak" },
        { id: "b2", name: "Drakloak" },
      ],
    };
    const { actorId } = resolveClaim(beat, "player", cards, EMPTY);
    expect(actorId).toBe("b1");
  });
});
