// Emit a TCG Live-format battle log from an AI Player session.
//
// WHY this format rather than our own: we already have a parser for it
// (lib/battle-log/parse.ts), a replay reducer, and an ML feature pipeline
// that consumes its output. Writing the same vocabulary means an AI Player
// game lands in that pipeline with no new ingest path, and a log a user
// pastes from TCG Live and a log we generated are interchangeable
// everywhere downstream.
//
// The contract is enforced, not asserted: battleLog.test.ts plays whole
// games, runs the emitted text through the REAL parser, and fails if any
// line comes back as action_type "unknown". If the parser's vocabulary and
// this emitter's ever drift apart, that test is what notices.
//
// Deliberately not modelled (TCG Live shows these; we have no equivalent):
//   * the loser's concede line — our games end on rules conditions only
//   * card-id prefixes ("(me2-5_155) N's Zekrom") — the parser strips them
//     anyway, and our instance ids are not TCG Live's
//   * the opponent's hidden hand contents, which real logs also omit

import type { GameState, CardInstance, PokemonInPlay } from "../types";
import type { SimMove } from "./moves";
import { computeDamage } from "./moves";
import { otherActor } from "./driver";
import { isSupporter } from "./trainers";

/** Who is who in the log's text. */
export interface LogHandles {
  player: string;
  opponent: string;
}

/** TCG Live handles are display names; ours come from a profile, so they
 *  can contain anything. Apostrophes and newlines are load-bearing in the
 *  log grammar ("<handle>'s Turn", "<handle>'s <mon> used ..."), so a
 *  handle carrying them would produce a log that mis-parses. */
export function sanitizeHandle(raw: string, fallback: string): string {
  const clean = raw
    .replace(/[‘’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean.slice(0, 40) : fallback;
}

export class BattleLogWriter {
  private lines: string[] = [];
  /** The section header currently open, so turns don't repeat one. */
  private section: string | null = null;

  constructor(private handles: LogHandles) {}

  handle(actor: "player" | "opponent"): string {
    return this.handles[actor];
  }

  /** Open a section ("Setup", "<handle>'s Turn", "Pokémon Checkup"). */
  section_(header: string): void {
    if (this.section === header) return;
    if (this.lines.length > 0) this.lines.push("");
    this.lines.push(header);
    this.section = header;
  }

  setup(): void {
    this.section_("Setup");
  }

  turn(actor: "player" | "opponent"): void {
    // A turn header must always open a new section even when the same
    // player takes consecutive turns (possible after a promotion pause),
    // so this bypasses the same-header short-circuit.
    if (this.lines.length > 0) this.lines.push("");
    this.lines.push(`${this.handle(actor)}'s Turn`);
    this.section = null;
  }

  checkup(): void {
    this.section_("Pokémon Checkup");
  }

  /** A primary action line. */
  line(text: string): void {
    this.lines.push(text);
  }

  /** A "- " sub-action under the previous primary line. */
  child(text: string): void {
    this.lines.push(`- ${text}`);
  }

  /** A "   • " card list under the previous line. Empty lists are skipped —
   *  a bullet with no cards is not something TCG Live ever writes. */
  bullets(names: string[]): void {
    if (names.length === 0) return;
    this.lines.push(`   • ${names.join(", ")}`);
  }

  render(): string {
    return this.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  get lineCount(): number {
    return this.lines.length;
  }
}

/* ─── Setup ─────────────────────────────────────────────────────── */

export function logSetup(
  w: BattleLogWriter,
  state: GameState,
  first: "player" | "opponent",
  /** Whose hand contents to reveal. Real logs show only the log owner's. */
  reveal: "player" | "opponent",
): void {
  w.setup();
  w.line(`${w.handle(first)} won the coin toss.`);
  w.line(`${w.handle(first)} decided to go first.`);

  for (const actor of ["player", "opponent"] as const) {
    const side = state.sides[actor];
    // The opening hand is what was drawn, which by this point has already
    // been split between hand and board — so it is reconstructed rather
    // than read off `hand`.
    const opening = [
      ...side.hand,
      ...(side.active ? [side.active.card] : []),
      ...side.bench.map((m) => m.card),
    ];
    w.line(`${w.handle(actor)} drew ${Math.min(7, opening.length)} cards for the opening hand.`);
    if (actor === reveal) w.bullets(opening.slice(0, 7).map((c) => c.name));
    else w.child(`${Math.min(7, opening.length)} drawn cards.`);

    if (side.mulligans === 1) w.line(`${w.handle(actor)} took a mulligan.`);
    else if (side.mulligans > 1) w.line(`${w.handle(actor)} took ${side.mulligans} mulligans.`);
  }

  // Board placement, in the order the rules resolve it.
  for (const actor of ["player", "opponent"] as const) {
    const side = state.sides[actor];
    if (side.active) w.line(`${w.handle(actor)} played ${side.active.card.name} to the Active Spot.`);
    for (const mon of side.bench) {
      w.line(`${w.handle(actor)} played ${mon.card.name} to the Bench.`);
    }
  }
}

/* ─── Per-move ──────────────────────────────────────────────────── */

/** Facts about a move that only exist BEFORE it is applied — card names,
 *  who was where, how much damage the attack will deal. Captured by
 *  `snapshotMove`, spent by `logMove`. */
export interface MoveSnapshot {
  lines: string[];
  /** Defender before the attack, to detect the KO afterwards. */
  defenderId: string | null;
  defenderName: string | null;
  prizesBefore: number;
}

const cardName = (side: { hand: CardInstance[] }, id: string | undefined): string =>
  side.hand.find((c) => c.id === id)?.name ?? "a card";

const monById = (state: GameState, actor: "player" | "opponent", id: string | undefined) => {
  const side = state.sides[actor];
  return [side.active, ...side.bench].find((m) => m?.id === id) ?? null;
};

/** Is this Pokémon the Active one? Decides "in the Active Spot" vs
 *  "on the Bench", which the parser reads as the location. */
const where = (state: GameState, actor: "player" | "opponent", mon: PokemonInPlay | null): string =>
  mon && state.sides[actor].active?.id === mon.id ? "in the Active Spot" : "on the Bench";

export function snapshotMove(
  w: BattleLogWriter,
  state: GameState,
  actor: "player" | "opponent",
  move: SimMove,
): MoveSnapshot {
  const me = w.handle(actor);
  const side = state.sides[actor];
  const foe = state.sides[otherActor(actor)];
  const lines: string[] = [];
  const snap: MoveSnapshot = {
    lines,
    defenderId: foe.active?.id ?? null,
    defenderName: foe.active?.card.name ?? null,
    prizesBefore: state.prizesTaken[actor],
  };

  switch (move.kind) {
    case "attach": {
      const target = monById(state, actor, move.targetId);
      lines.push(
        `${me} attached ${cardName(side, move.cardId)} to ${target?.card.name ?? "a Pokémon"} ${where(state, actor, target)}.`,
      );
      break;
    }
    case "bench":
      lines.push(`${me} played ${cardName(side, move.cardId)} to the Bench.`);
      break;
    case "evolve": {
      const target = monById(state, actor, move.targetId);
      lines.push(
        `${me} evolved ${target?.card.name ?? "a Pokémon"} to ${cardName(side, move.cardId)} ${where(state, actor, target)}.`,
      );
      break;
    }
    case "retreat": {
      const active = side.active;
      const incoming = side.bench[move.benchIndex];
      if (active) lines.push(`${me} retreated ${active.card.name} to the Bench.`);
      if (incoming) lines.push(`${me}'s ${incoming.card.name} is now in the Active Spot.`);
      break;
    }
    case "cycle_supporter":
    case "cycle_item":
    case "play_trainer":
    case "attach_tool":
      lines.push(`${me} played ${cardName(side, move.cardId)}.`);
      break;
    case "play_stadium":
      lines.push(`${me} played ${cardName(side, move.cardId)} to the Stadium spot.`);
      break;
    case "use_stadium":
      lines.push(`${move.stadiumName} was activated.`);
      break;
    case "effect": {
      // A declarative effect is sourced either from a hand card (a Trainer
      // play) or from a Pokémon in play (an ability use). Same move kind,
      // two different log lines.
      const fromHand = side.hand.find((c) => c.id === move.sourceId);
      if (fromHand) {
        lines.push(`${me} played ${fromHand.name}.`);
      } else {
        const mon = monById(state, actor, move.sourceId);
        lines.push(`${me}'s ${mon?.card.name ?? move.card} used ${move.card}.`);
      }
      break;
    }
    case "use_ability": {
      const mon = monById(state, actor, move.monId);
      lines.push(`${me}'s ${mon?.card.name ?? "Pokémon"} used ${move.abilityName}.`);
      break;
    }
    case "attack": {
      const attacker = side.active;
      const attack = attacker?.card.catalog?.attacks[move.attackIndex];
      if (!attacker || !attack) break;
      if (foe.active) {
        const dmg = computeDamage(attacker, attack, foe.active);
        // TCG Live writes the damage-dealing form only when damage lands;
        // a utility attack uses the short form, and the parser has a
        // separate pattern for each.
        lines.push(
          dmg > 0
            ? `${me}'s ${attacker.card.name} used ${attack.name} on ${w.handle(otherActor(actor))}'s ${foe.active.card.name} for ${dmg} damage.`
            : `${me}'s ${attacker.card.name} used ${attack.name}.`,
        );
      } else {
        lines.push(`${me}'s ${attacker.card.name} used ${attack.name}.`);
      }
      break;
    }
    case "pass":
      lines.push(`${me} ended their turn.`);
      break;
  }
  return snap;
}

/** Write the snapshot's lines, then anything only observable AFTER the
 *  move: a knockout, and the prizes it paid out. */
export function logMove(
  w: BattleLogWriter,
  state: GameState,
  actor: "player" | "opponent",
  snap: MoveSnapshot,
): void {
  for (const l of snap.lines) w.line(l);

  const foe = state.sides[otherActor(actor)];
  const stillThere =
    snap.defenderId !== null &&
    [foe.active, ...foe.bench].some((m) => m?.id === snap.defenderId);
  if (snap.defenderId !== null && !stillThere && snap.defenderName) {
    w.line(`${w.handle(otherActor(actor))}'s ${snap.defenderName} was Knocked Out!`);
  }

  const taken = state.prizesTaken[actor] - snap.prizesBefore;
  if (taken === 1) w.line(`${w.handle(actor)} took a Prize card.`);
  else if (taken > 1) w.line(`${w.handle(actor)} took ${taken} Prize cards.`);
}

/* ─── Turn structure ────────────────────────────────────────────── */

export function logTurnStart(
  w: BattleLogWriter,
  actor: "player" | "opponent",
  drew: CardInstance | null,
  reveal: "player" | "opponent",
): void {
  w.turn(actor);
  // Real logs name the card only for the log's owner; the opponent's draw
  // is "drew a card".
  if (!drew) return;
  w.line(actor === reveal ? `${w.handle(actor)} drew ${drew.name}.` : `${w.handle(actor)} drew a card.`);
}

export function logPromotion(
  w: BattleLogWriter,
  state: GameState,
  actor: "player" | "opponent",
): void {
  const active = state.sides[actor].active;
  if (active) w.line(`${w.handle(actor)}'s ${active.card.name} is now in the Active Spot.`);
}

export function logGameEnd(
  w: BattleLogWriter,
  winner: "player" | "opponent" | null,
  endReason: string | null,
): void {
  if (!winner) return; // a draw has no TCG Live line; the row's outcome carries it
  const loser = otherActor(winner);
  switch (endReason) {
    case "deck_out":
      w.line(`${w.handle(loser)} decked out. ${w.handle(winner)} wins.`);
      break;
    case "no_active":
      w.line(`${w.handle(loser)} had no Pokémon left. ${w.handle(winner)} wins.`);
      break;
    default:
      w.line(`All Prize cards taken. ${w.handle(winner)} wins.`);
  }
}

/** Supporter vs Item, for the "played X" line's action_type. Not used by
 *  the emitter (the parser decides from the catalog) but exported so the
 *  persistence layer can record counts without re-deriving them. */
export function isSupporterCard(card: CardInstance): boolean {
  return isSupporter(card);
}
