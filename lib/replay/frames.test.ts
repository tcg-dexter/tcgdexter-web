import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReplayPayload, groupAttachments } from "./frames";

const EXAMPLE = readFileSync(
  join(__dirname, "..", "battle-log", "fixtures", "example-1.txt"),
  "utf8",
);

// Real match with interleaved duplicate energies and a Pokémon Tool that
// the log attaches through an energy line — see the grouping suite below.
const SAME_NAME_ATTACH = readFileSync(
  join(__dirname, "..", "battle-log", "fixtures", "example-3-same-name-attach.txt"),
  "utf8",
);

const payload = buildReplayPayload("m1", EXAMPLE, "MoonSheikah");

// A discard-then-draw exchange is a single action in the log — TCG Live
// writes the discard and draw as child lines, not entries — but the viewer
// walks it a beat at a time, so buildReplayPayload expands it into three
// frames. The overlay's behaviour rests entirely on the shape of that
// expansion: it reveals a group per stage, and it stays mounted across the
// three because AnimatePresence is keyed on actionIndex. Break the order,
// the adjacency, or the shared index and the overlay either shows the wrong
// groups or blinks out between beats.
describe("replay frames: discard-then-draw staging", () => {
  const exchangeStarts = payload.frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.discardDraw?.stage === "play");

  it("is not a vacuous guard — the fixture contains exchanges", () => {
    expect(exchangeStarts.length).toBeGreaterThan(0);
  });

  it("expands each exchange into play → discard → draw on adjacent frames", () => {
    for (const { i } of exchangeStarts) {
      expect(
        [0, 1, 2].map((k) => payload.frames[i + k]?.discardDraw?.stage),
      ).toEqual(["play", "discard", "draw"]);
    }
  });

  it("gives all three frames of an exchange the same actionIndex", () => {
    // Shared index is what keeps the overlay mounted across the stages, and
    // what keeps the thread spotlighting one post for the whole exchange.
    for (const { i } of exchangeStarts) {
      const indices = [0, 1, 2].map((k) => payload.frames[i + k].actionIndex);
      expect(new Set(indices).size).toBe(1);
    }
  });

  it("carries the same exchange payload on every stage", () => {
    for (const { i } of exchangeStarts) {
      const [a, b, c] = [0, 1, 2].map(
        (k) => payload.frames[i + k].discardDraw!,
      );
      for (const other of [b, c]) {
        expect(other.source).toEqual(a.source);
        expect(other.discarded).toEqual(a.discarded);
        expect(other.drawn).toEqual(a.drawn);
        expect(other.drawnCount).toBe(a.drawnCount);
        expect(other.actor).toBe(a.actor);
      }
    }
  });

  it("only marks frames that both discarded and drew", () => {
    // A bare discard (a retreat cost) or a bare draw (start of turn) is
    // ordinary board state; raising a full-mat overlay for those would bury
    // the board in interruptions.
    for (const frame of payload.frames) {
      if (!frame.discardDraw) continue;
      expect(frame.discardDraw.discarded.length).toBeGreaterThan(0);
      expect(frame.discardDraw.drawnCount).toBeGreaterThan(0);
    }
  });

  it("resolves art for every card it puts on screen", () => {
    const cards = payload.frames
      .filter((f) => f.discardDraw?.stage === "play")
      .flatMap((f) => [
        f.discardDraw!.source,
        ...f.discardDraw!.discarded,
        ...f.discardDraw!.drawn,
      ]);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((c) => !c.imageUrl)).toEqual([]);
  });
});

// The mulligan overlay's row count only ever grows and its cards only ever
// come from a fixed sequence of "mulligan" then "mulligan_total" actions —
// but that sequence can span TWO source actions with a running per-actor
// accumulator threading them together (see buildReplayPayload), which is
// exactly the kind of state that's easy to get right for one player and
// wrong for interleaved cases, or right for row 1 and wrong once a second
// action starts appending to it.
describe("replay frames: mulligan staging", () => {
  // MoonSheikah mulligans 3 times in this fixture: once via a standalone
  // "mulligan" action, then twice more bundled into one "mulligan_total".
  const beats = payload.frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.mulligan);

  it("is not a vacuous guard — the fixture contains a multi-mulligan sequence", () => {
    expect(beats.length).toBeGreaterThan(1);
  });

  it("reveals exactly one new row per beat, in order", () => {
    beats.forEach(({ f }, i) => {
      expect(f.mulligan!.rows.length).toBe(i + 1);
    });
  });

  it("carries every earlier row forward unchanged as later rows land", () => {
    const rowNames = (rows: { name: string }[][]) =>
      rows.map((r) => r.map((c) => c.name));
    for (let i = 1; i < beats.length; i++) {
      const prev = rowNames(beats[i - 1].f.mulligan!.rows);
      const cur = rowNames(beats[i].f.mulligan!.rows).slice(0, prev.length);
      expect(cur).toEqual(prev);
    }
  });

  it("reports the same final total row count on every beat", () => {
    const totals = Array.from(new Set(beats.map(({ f }) => f.mulligan!.totalRows)));
    expect(totals.length).toBe(1);
    expect(totals[0]).toBe(beats.length);
  });

  it("clears immediately after the sequence's last beat", () => {
    const lastBeatFrameIndex = beats[beats.length - 1].i;
    expect(payload.frames[lastBeatFrameIndex + 1].mulligan).toBeNull();
  });

  it("each row holds a full opening hand and resolves art for every card", () => {
    const last = beats[beats.length - 1].f.mulligan!;
    for (const row of last.rows) {
      expect(row.length).toBe(7);
      expect(row.filter((c) => !c.imageUrl)).toEqual([]);
    }
  });
});

// The player/opponent hand asymmetry the mulligan and discard/draw work
// above already leans on is worth its own explicit test: TCG Live's export
// only names the exporting account's own drawn cards, so `player_handle`
// isn't just a display label — it decides which side's SideFrame.hand comes
// back as real, image-resolved cards versus CardInstance.unrevealed
// placeholders. example-1.txt's raw text names a11father's cards throughout
// (draws, prize pickups) and anonymises MoonSheikah's, so a11father is this
// fixture's actual "exporting account" regardless of which side other tests
// in this file pick as the perspective.
describe("replay frames: hand visibility follows player_handle", () => {
  const asExporter = buildReplayPayload("m1", EXAMPLE, "a11father");
  const asOtherSide = buildReplayPayload("m1", EXAMPLE, "MoonSheikah");

  it("gives the exporting account's perspective real, resolved hand cards", () => {
    const midGame = asExporter.frames.find(
      (f) => f.player.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    for (const card of midGame!.player.hand) {
      expect(card.revealed).toBe(true);
      expect(card.name).not.toBe("(unrevealed)");
      expect(card.imageUrl).not.toBeNull();
    }
  });

  it("keeps the non-exporting side's hand as unrevealed placeholders", () => {
    const midGame = asExporter.frames.find(
      (f) => f.opponent.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    for (const card of midGame!.opponent.hand) {
      expect(card.revealed).toBe(false);
      expect(card.imageUrl).toBeNull();
    }
  });

  it("flips which side is which when the chosen perspective flips", () => {
    // Same raw log, opposite player_handle — the exporting account
    // (a11father) is now `opponent`, so it should be its hand that's real.
    const midGame = asOtherSide.frames.find(
      (f) => f.opponent.hand.length > 0 && f.turn > 3,
    );
    expect(midGame).toBeDefined();
    expect(midGame!.opponent.hand.every((c) => c.revealed)).toBe(true);
  });

  it("keeps hand count accurate even when contents are hidden", () => {
    // handCount has to stay trustworthy on its own — the UI's other hand
    // affordances (deck/hand tallies elsewhere on the mat) read it
    // independent of whether the strip can show real art for it.
    for (const f of asExporter.frames) {
      expect(f.opponent.handCount).toBe(f.opponent.hand.length);
      expect(f.player.handCount).toBe(f.player.hand.length);
    }
  });
});

// The card inspector's attached-cards row reads PokemonFrame.attachedCards
// directly, so it has to agree with the energy names the board's own
// footer already shows (PokemonFrame.energy) and resolve art for each —
// unlike energy, which frames.ts already exposed as bare names with no
// image, attachedCards is new and is the row's only data source.
describe("replay frames: attached cards", () => {
  const asExporter = buildReplayPayload("m1", EXAMPLE, "a11father");

  it("is not a vacuous guard — some in-play Pokémon has energy attached", () => {
    const hasAttached = asExporter.frames.some((f) =>
      [f.player.active, ...f.player.bench, f.opponent.active, ...f.opponent.bench].some(
        (mon) => mon && mon.attachedCards.length > 0,
      ),
    );
    expect(hasAttached).toBe(true);
  });

  it("carries exactly the same cards as energy + tools, each resolved to art", () => {
    // Ordering is deliberately NOT asserted here — attachedCards is grouped
    // rather than in attach order (see the grouping suite below). What must
    // hold is that grouping neither drops nor invents a card.
    for (const f of asExporter.frames) {
      for (const mon of [
        f.player.active,
        ...f.player.bench,
        f.opponent.active,
        ...f.opponent.bench,
      ]) {
        if (!mon) continue;
        const expected = [...mon.energy, ...mon.tools.map((t) => t.name)].sort();
        expect(mon.attachedCards.map((c) => c.name).sort()).toEqual(expected);
        for (const c of mon.attachedCards) expect(c.imageUrl).not.toBeNull();
      }
    }
  });
});

// The inspector's attached row should read as "two Fire, one Psychic", not
// as three unrelated cards, so attachedCards clusters like with like. This
// fixture is the real match that motivated it: its Dragapult ex takes a
// Fire, then a Psychic, then a second Fire, and its Cynthia's Garchomp ex
// ends up holding a Pokémon Tool alongside three energies.
describe("replay frames: attachments are grouped, not in attach order", () => {
  const payload = buildReplayPayload("m3", SAME_NAME_ATTACH, "Nnova12");
  const allMons = payload.frames.flatMap((f) =>
    [f.player.active, ...f.player.bench, f.opponent.active, ...f.opponent.bench].filter(
      (m): m is NonNullable<typeof m> => m != null,
    ),
  );

  it("is not a vacuous guard — raw attach order really does interleave duplicates", () => {
    // Proves the fixture exercises the bug: some Pokémon's `energy` (which
    // stays in true attach order) has a name recurring after a different one.
    const interleaved = allMons.some((mon) => {
      const seenRun = new Set<string>();
      let prev: string | null = null;
      for (const name of mon.energy) {
        if (name !== prev && seenRun.has(name)) return true;
        seenRun.add(name);
        prev = name;
      }
      return false;
    });
    expect(interleaved).toBe(true);
  });

  it("keeps every copy of a card adjacent to its twins", () => {
    for (const mon of allMons) {
      const names = mon.attachedCards.map((c) => c.name);
      const runs: string[] = [];
      for (const n of names) if (n !== runs[runs.length - 1]) runs.push(n);
      // A name appearing in two separate runs means the copies got split.
      expect(runs.length).toBe(new Set(runs).size);
    }
  });

  it("orders energy ahead of Tools", () => {
    // Cynthia's Power Weight is a Trainer / Pokémon Tool that TCG Live logs
    // as an ordinary "attached" line; the reducer routes it to attachedTools
    // and the row has to keep it behind the real energies.
    // Needs a Pokémon holding the Tool *alongside* energy — early on it's
    // the only attachment, which wouldn't exercise the ordering at all.
    const withBoth = allMons.find(
      (mon) =>
        mon.attachedCards.some((c) => c.name === "Cynthia's Power Weight") &&
        mon.energy.some((n) => n !== "Cynthia's Power Weight"),
    );
    expect(withBoth).toBeDefined();
    const names = withBoth!.attachedCards.map((c) => c.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names[names.length - 1]).toBe("Cynthia's Power Weight");
    // And nothing else may sit after the first Tool.
    expect(names.indexOf("Cynthia's Power Weight")).toBe(names.length - 1);
  });

  // The fixtures above all happen to attach their Tool last, so they'd pass
  // even with kind-classification switched off entirely (verified by
  // mutation). Only a Tool-FIRST list actually proves the catalog lookup is
  // doing the work, and no real log in the repo produces one — hence
  // driving groupAttachments directly.
  describe("groupAttachments (direct)", () => {
    const card = (name: string) => ({ name, imageUrl: null });

    it("pulls a Tool behind energy that was attached after it", () => {
      const grouped = groupAttachments([
        card("Cynthia's Power Weight"), // Trainer / Pokémon Tool
        card("Basic Fire Energy"),
        card("Basic Psychic Energy"),
      ]);
      expect(grouped.map((c) => c.name)).toEqual([
        "Basic Fire Energy",
        "Basic Psychic Energy",
        "Cynthia's Power Weight",
      ]);
    });

    it("clusters duplicates while keeping first-appearance order between groups", () => {
      const grouped = groupAttachments([
        card("Basic Psychic Energy"),
        card("Basic Fire Energy"),
        card("Basic Psychic Energy"),
      ]);
      // Psychic leads because it was attached first, and both copies of it
      // sit together — alphabetical ordering would have put Fire first.
      expect(grouped.map((c) => c.name)).toEqual([
        "Basic Psychic Energy",
        "Basic Psychic Energy",
        "Basic Fire Energy",
      ]);
    });

    it("leaves an already-grouped list untouched", () => {
      const names = ["Basic Fire Energy", "Basic Fire Energy", "Cynthia's Power Weight"];
      expect(groupAttachments(names.map(card)).map((c) => c.name)).toEqual(names);
    });
  });
});

// The discard-pile inspector's grid reads SideFrame.discard directly, so it
// has to track discardCount/discardTop (already trusted elsewhere) rather
// than drifting from them, and resolve art for every card, not just the top.
describe("replay frames: full discard pile", () => {
  const asExporter = buildReplayPayload("m1", EXAMPLE, "a11father");

  it("is not a vacuous guard — some frame has cards in the discard pile", () => {
    const hasDiscards = asExporter.frames.some(
      (f) => f.player.discard.length > 0 || f.opponent.discard.length > 0,
    );
    expect(hasDiscards).toBe(true);
  });

  it("matches discardCount and, when non-empty, discardTop for every frame/side", () => {
    for (const f of asExporter.frames) {
      for (const side of [f.player, f.opponent]) {
        expect(side.discard.length).toBe(side.discardCount);
        if (side.discard.length > 0) {
          // Index 0 is the pile's top — the same card discardTop names.
          expect(side.discard[0].name).toBe(side.discardTop);
          expect(side.discard[0].imageUrl).toBe(side.discardTopImageUrl);
        }
      }
    }
  });

  it("orders the pile most-recently-discarded first", () => {
    // MoonSheikah's Budew is Knocked Out, then — in the same block, right
    // after — their (second, Buddy-Buddy Poffin-fetched) Froakie is too. The
    // more recent KO (Froakie) should read before the earlier one (Budew),
    // not in the order they actually happened.
    //
    // Anchored on the knockout itself rather than on "the first frame where
    // both names appear". That shortcut was only ever accidentally correct:
    // this deck runs two Froakie, and once the parser started reading the
    // Buddy-Buddy Poffin bench fetches, the other one reaches the discard
    // well before either knockout — so the shortcut started selecting a
    // frame from the middle of the game and comparing the wrong Froakie.
    const afterBothKOs = asExporter.frames.find((f) =>
      /Froakie was Knocked Out/.test(f.summary),
    );
    expect(afterBothKOs).toBeDefined();
    const names = afterBothKOs!.opponent.discard.map((c) => c.name);
    expect(names).toContain("Budew");
    expect(names.indexOf("Froakie")).toBeLessThan(names.indexOf("Budew"));
  });

  it("resolves art for every card in the pile", () => {
    const withDiscards = asExporter.frames.find((f) => f.player.discard.length >= 3);
    expect(withDiscards).toBeDefined();
    for (const c of withDiscards!.player.discard) {
      expect(c.imageUrl).not.toBeNull();
    }
  });
});
