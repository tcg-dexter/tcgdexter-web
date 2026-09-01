import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import type { EngineEvent } from "@/lib/engine";
import type { ParsedAction } from "@/lib/battle-log";
import type { ReplayPayload } from "@/lib/replay/frames";

/**
 * Replay 2.0's beat stream.
 *
 * The v1 viewer animates by diffing consecutive `ReplayFrame`s: framer-motion
 * sees a card's layoutId move between slots and tweens it. That works, but it
 * means the board never learns WHAT happened — a draw, an evolution and a
 * lethal attack are all "some cards moved", so they all read the same and all
 * take the same 1000/speed milliseconds.
 *
 * The engine already knows. `applyAction` emits an EngineEvent per action with
 * a rich `detail` payload (lib/engine/reducer.ts), and `buildReplayPayload`
 * throws it away because the v1 board has nothing to do with it. This module
 * picks it back up and narrows the loose `{ kind: string; detail: Record<…> }`
 * into a discriminated union the choreographer can switch on exhaustively.
 *
 * Guiding principle for everything downstream: **the frame is the truth, the
 * beat is the performance.** Board state still comes from ReplayFrame and is
 * never derived from a beat — beats only drive motion, FX, camera and audio on
 * top of it. That's what keeps the thread sync (frame.actionIndex →
 * BattleLogDetail's maxSequence) correct for free, and what lets a scrub drop
 * every beat and cut straight to state.
 *
 * Purely additive: lib/replay/frames.ts and everything the production battles
 * page renders is untouched. Beats are served alongside the identical v1
 * payload from /api/admin/replay2/[battleId].
 */

export type BeatActor = "player" | "opponent" | "system";

/**
 * How much screen time and ceremony a beat has earned. The director turns
 * this into a duration and the choreographer into camera/FX intensity, so
 * pacing is tuned in one table rather than per action type.
 */
export type BeatWeight = "ambient" | "normal" | "major" | "climax";

export type TrainerSubtype = "item" | "supporter" | "tool" | "stadium";

/**
 * Where on a mat a beat's subject is standing, when that is known.
 *
 * `null` means the log didn't say and the engine couldn't resolve it — NOT
 * "the Active Spot". The board treats a null as "don't constrain by
 * position", which degrades to name matching; defaulting it to "active"
 * instead would confidently animate the wrong card.
 */
export type BoardSlot = "active" | "bench" | null;

function toSlot(v: unknown): BoardSlot {
  return v === "active" || v === "bench" ? v : null;
}

export interface SplashHit {
  handle: string;
  pokemon: string;
  damage: number;
}

interface BeatBase {
  /** Index into the parsed action stream — the join key to ReplayFrame. */
  actionIndex: number;
  actor: BeatActor;
  weight: BeatWeight;
  /** The log's own line. Already on the frame; carried here so a beat is
   *  self-describing in isolation (tests, debugging, the director's log). */
  summary: string;
}

export type Beat = BeatBase &
  (
    | { kind: "draw"; count: number; cards: string[] }
    | {
        kind: "attach_energy";
        energy: string;
        /** Basic energy type label, or "Colorless" for special/blend energy.
         *  Not on the engine event — derived here so FX can colour the trail
         *  by type without a catalog lookup in the browser. */
        energyType: string;
        target: string;
        /** Which slot the receiving Pokémon is in. The parser records it on
         *  every attachment line ("...in the Active Spot" / "...on the
         *  Bench") and it was being dropped; the board needs it to tell two
         *  same-named Pokémon apart. */
        location: BoardSlot;
        /** Attached by a card effect rather than the once-per-turn manual
         *  attachment — a smaller moment, so it gets a lighter beat. */
        viaEffect: boolean;
        tool: boolean;
      }
    | { kind: "play_to_slot"; card: string; slot: "active" | "bench" }
    | { kind: "evolve"; from: string; to: string; location: string | null }
    | { kind: "retreat"; discarded: string[] }
    | { kind: "switch_active"; promoted: string; conjured: boolean; noop: boolean }
    | { kind: "play_trainer"; card: string; subtype: TrainerSubtype }
    | { kind: "ability"; source: string; ability: string }
    | {
        kind: "attack";
        attacker: string;
        attack: string | null;
        defender: string;
        damage: number;
        weaknessBonus: number | null;
        splash: SplashHit[];
      }
    | { kind: "knock_out"; pokemon: string; where: BoardSlot }
    | { kind: "prize_taken"; count: number }
    | { kind: "condition"; pokemon: string; condition: string }
    | {
        kind: "damage_counters";
        pokemon: string;
        counters: number;
        /** The Special Condition that caused it — "Poisoned" or "Burned" —
         *  when that's why the counters landed. The board colours its
         *  between-turns damage by it. */
        fromCondition: string | null;
      }
    /** One effect placing counters on several Pokémon at once — Freezing
     *  Shroud during Pokémon Checkup. `applied` is what the engine actually
     *  resolved, with the owner it landed on, since the log's own owner
     *  attribution is unreliable; `targets` is what the log claimed, kept so
     *  the board can still say something when a target didn't resolve. */
    | {
        kind: "damage_counters_placed";
        applied: { pokemon: string; owner: BeatActor; counters: number }[];
        targets: string[];
      }
    /** Counters moved between two Pokémon — Adrena-Brain. */
    | {
        kind: "damage_counters_moved";
        from: string;
        to: string;
        counters: number;
        fromOwner: BeatActor | null;
        toOwner: BeatActor | null;
        resolved: boolean;
      }
    | { kind: "discard"; cards: string[] }
    | { kind: "discard_from_pokemon"; card: string; from: string }
    | { kind: "shuffle"; count: number }
    | { kind: "reveal"; cards: string[] }
    | { kind: "to_hand"; card: string | null; hidden: boolean }
    | { kind: "mulligan"; count: number }
    | { kind: "opening_hand"; handSize: number }
    | { kind: "mulligan_total"; total: number }
    /** A passive card firing on its own — a Stadium's trigger, a Tool's.
     *  Nobody "plays" it, so it has an actor of `system` as often as not and
     *  the card named is the only subject there is. */
    | { kind: "effect_activated"; card: string }
    | { kind: "chose_first"; firstPlayer: BeatActor | null }
    | { kind: "turn_start"; turn: number; playerTurnNumber: number }
    | { kind: "turn_end" }
    /**
     * The flip comes through as two distinct log lines — "X chose heads for
     * the opening coin flip" (call) and "X won the coin toss" (won) — and
     * the ceremony treats them as two separate beats: the caller's mat
     * spotlights on `call`, the winner's on `won` (though the winner's
     * plate is largely superseded by the following chose_first, so its
     * choreography is short and low-key). Merging them like it used to did
     * mean two identical beats fired for the same event and nothing said
     * which was which.
     */
    | { kind: "coin_flip"; stage: "call" | "won"; choice: string | null }
    | { kind: "game_end"; winner: BeatActor | null; reason: string | null }
    /** Anything without its own choreography yet. Carries the raw action
     *  type so the director can still pace it and a breadth pass can find
     *  what's left unstyled. */
    | { kind: "generic"; actionKind: string }
  );

/* ──────────────────────────────────────────────────────────────── */
/* Energy typing                                                    */
/* ──────────────────────────────────────────────────────────────── */

const BASIC_TYPES = new Set([
  "grass",
  "fire",
  "water",
  "lightning",
  "psychic",
  "fighting",
  "darkness",
  "metal",
  "fairy",
  "dragon",
  "colorless",
]);

/** Deliberate copy of frames.ts's private `energyTypeFromName`. Replay 2.0 is
 *  a fork that promises not to edit a single production file, and exporting
 *  the original just to share ten lines would break that promise for no real
 *  gain. If the two ever need to diverge, they can. */
function energyTypeFromName(name: string): string {
  const m =
    name.match(/^Basic\s+([A-Za-z]+)\s+Energy$/i) ??
    name.match(/^([A-Za-z]+)\s+Energy$/);
  if (m && BASIC_TYPES.has(m[1].toLowerCase())) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return "Colorless";
}

/* ──────────────────────────────────────────────────────────────── */
/* detail coercion                                                  */
/* ──────────────────────────────────────────────────────────────── */

// EngineEvent.detail is `Record<string, unknown>` by design — the engine
// keeps it loose so a parser addition doesn't force an engine bump. These
// narrow it at the one boundary where it becomes typed, so a missing or
// surprising field degrades to a sane default instead of an `undefined`
// reaching the choreographer.

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function splashArray(v: unknown): SplashHit[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    return [{ handle: str(r.handle), pokemon: str(r.pokemon), damage: num(r.damage) }];
  });
}

function toActor(a: string): BeatActor {
  return a === "player" || a === "opponent" ? a : "system";
}

/* ──────────────────────────────────────────────────────────────── */
/* Event → Beat                                                     */
/* ──────────────────────────────────────────────────────────────── */

/** Base weight per action type. The director scales duration off this, so
 *  this table is the single place replay pacing is tuned. A few beats
 *  override it below based on their own detail — an attachment made by a
 *  card effect is a smaller moment than a manual energy drop, and a
 *  no-op promotion shouldn't stop the show at all. */
const WEIGHTS: Record<string, BeatWeight> = {
  // Barely-there bookkeeping: the log records it, the table wouldn't notice.
  coin_flip: "ambient",
  coin_toss_won: "ambient",
  chose_first: "normal",
  turn_end: "ambient",
  shuffle: "ambient",
  reveal: "ambient",
  add_to_hand: "ambient",
  move_to_hand: "ambient",
  effect_activated: "normal",
  mulligan_total: "ambient",
  mulligan_bonus_draw: "ambient",
  damage_dealt: "ambient",
  unknown: "ambient",

  // Ordinary turn texture.
  draw: "normal",
  discard: "normal",
  discard_from_pokemon: "normal",
  attach_energy: "normal",
  play_supporter: "normal",
  play_item: "normal",
  play_tool: "normal",
  play_to_bench: "normal",
  ability_used: "normal",
  condition_applied: "normal",
  damage_counter_placed: "normal",
  // A board-wide effect that can shift several Pokémon at once toward a
  // knockout — worth more than the ordinary turn texture around it.
  damage_counters_placed: "major",
  damage_counters_moved: "major",
  opening_hand: "normal",

  // Board-shape changes the eye should follow.
  play_to_active: "major",
  play_stadium: "major",
  evolve: "major",
  retreat: "major",
  switch_active: "major",
  prize_taken: "major",
  turn_start: "major",
  mulligan: "major",

  // The moments people replay a battle for.
  attack: "climax",
  knock_out: "climax",
  game_end: "climax",
};

function weightFor(kind: string): BeatWeight {
  return WEIGHTS[kind] ?? "normal";
}

/**
 * Narrow one engine event into a beat.
 *
 * Reads each field from `event.detail` first and falls back to the parsed
 * action's own payload. That fallback is not belt-and-braces: `applyAction`
 * has an early `break` on every path where it can't apply an action to the
 * state — an evolution whose base was never tracked into play, an attachment
 * whose target isn't found — and those paths leave `detail` an empty object
 * while still emitting the event. example-1 alone hits it (a Froakie the
 * parser never benched, evolving to Frogadier). Without the fallback those
 * beats reach the choreographer with empty names and animate as blanks —
 * silently, on exactly the frames where the log is already lossy.
 *
 * The two sources use different key names (`detail.attack` vs
 * `payload.attack_name`, `detail.drew` vs `payload.count`), so each field
 * spells out its own pair rather than merging the objects wholesale.
 */
function toBeat(ev: EngineEvent, action: ParsedAction | undefined): Beat {
  const base = {
    actionIndex: ev.actionIndex,
    actor: toActor(ev.actor),
    weight: weightFor(ev.kind),
    summary: ev.summary,
  };
  const d = ev.detail;
  const p: Record<string, unknown> = action?.payload ?? {};

  switch (ev.kind) {
    case "draw":
    case "mulligan_bonus_draw":
      return {
        ...base,
        kind: "draw",
        count: num(d.drew ?? p.count, 1),
        cards: strArray(d.cards ?? p.revealed_cards),
      };

    case "attach_energy": {
      const energy = str(d.energy ?? p.energy);
      const viaEffect = bool(d.viaEffect ?? p.via_effect);
      return {
        ...base,
        // An effect-driven attachment is one line in a chain of them (a
        // single Item can attach three), so it stays out of the way; the
        // once-per-turn manual drop is the one worth watching.
        weight: viaEffect ? "ambient" : "normal",
        kind: "attach_energy",
        energy,
        energyType: energyTypeFromName(energy),
        target: str(d.target ?? p.target),
        location: toSlot(p.location),
        viaEffect,
        tool: bool(d.tool),
      };
    }

    case "play_to_active":
    case "play_to_bench":
      return {
        ...base,
        kind: "play_to_slot",
        card: str(d.card ?? p.card),
        // The action type is authoritative for the slot — detail.slot is
        // derived from it, and is absent entirely on the bail-out path.
        slot: ev.kind === "play_to_active" ? "active" : "bench",
      };

    case "evolve":
      return {
        ...base,
        kind: "evolve",
        from: str(d.from ?? p.from),
        to: str(d.to ?? p.to),
        location: strOrNull(d.location ?? p.location),
      };

    case "retreat":
      return {
        ...base,
        kind: "retreat",
        discarded: strArray(d.discarded ?? p.discarded_energies),
      };

    case "switch_active": {
      const noop = bool(d.noop);
      return {
        ...base,
        // A confirmation line for a promotion that already happened has
        // nothing to show — don't hold the board for it.
        weight: noop ? "ambient" : base.weight,
        kind: "switch_active",
        promoted: str(d.promoted ?? p.pokemon),
        conjured: bool(d.conjured),
        noop,
      };
    }

    case "play_supporter":
    case "play_item":
    case "play_tool":
      return {
        ...base,
        kind: "play_trainer",
        card: str(d.card ?? p.card),
        // The reducer classifies from the catalog, which is better than the
        // parser's guess (many Supporters arrive coded as play_item), so
        // prefer it. The action type is only the fallback for the bail-out
        // path, where nothing was classified at all.
        subtype: bool(d.supporter)
          ? "supporter"
          : bool(d.tool)
            ? "tool"
            : ev.kind === "play_supporter"
              ? "supporter"
              : ev.kind === "play_tool"
                ? "tool"
                : "item",
      };

    case "play_stadium":
      return {
        ...base,
        kind: "play_trainer",
        card: str(d.card ?? p.card),
        subtype: "stadium",
      };

    case "ability_used":
      return {
        ...base,
        kind: "ability",
        source: str(d.source ?? p.source),
        ability: str(d.ability ?? p.ability_name),
      };

    case "attack":
      return {
        ...base,
        kind: "attack",
        attacker: str(d.attacker ?? p.attacker),
        attack: strOrNull(d.attack ?? p.attack_name),
        defender: str(d.defender ?? p.defender),
        damage: num(d.damage ?? p.damage),
        weaknessBonus: numOrNull(d.weakness_bonus ?? p.weakness_bonus),
        splash: splashArray(d.splash ?? p.splash_damage),
      };

    case "knock_out":
      // The engine resolves `where` by finding the Pokémon in play; the
      // parser's own line never says. So an unresolvable knockout — the
      // untracked-Pokémon case documented above — leaves this null rather
      // than guessing "active", which would have pinned a benched knockout's
      // debris to the wrong card.
      return {
        ...base,
        kind: "knock_out",
        pokemon: str(d.pokemon ?? p.pokemon),
        where: toSlot(d.where),
      };

    case "prize_taken":
      return { ...base, kind: "prize_taken", count: num(d.count ?? p.count, 1) };

    case "condition_applied":
      return {
        ...base,
        kind: "condition",
        pokemon: str(d.pokemon ?? p.pokemon),
        condition: str(d.condition ?? p.condition),
      };

    case "damage_counter_placed":
      return {
        ...base,
        kind: "damage_counters",
        pokemon: str(d.pokemon ?? p.pokemon),
        counters: num(d.counters ?? p.counters),
        fromCondition: strOrNull(d.from_condition ?? p.from_condition),
      };

    case "damage_counters_placed": {
      const applied = Array.isArray(d.applied) ? d.applied : [];
      return {
        ...base,
        kind: "damage_counters_placed",
        applied: applied.flatMap((raw) => {
          if (typeof raw !== "object" || raw === null) return [];
          const r = raw as Record<string, unknown>;
          return [
            {
              pokemon: str(r.pokemon),
              owner: toActor(str(r.owner, "system")),
              counters: num(r.counters, 1),
            },
          ];
        }),
        targets: strArray(d.targets ?? p.targets),
      };
    }

    case "damage_counters_moved":
      return {
        ...base,
        kind: "damage_counters_moved",
        from: str(d.from ?? p.from),
        to: str(d.to ?? p.to),
        counters: num(d.counters ?? p.counters),
        fromOwner: d.fromOwner ? toActor(str(d.fromOwner)) : null,
        toOwner: d.toOwner ? toActor(str(d.toOwner)) : null,
        resolved: bool(d.resolved),
      };

    case "discard": {
      const named = strOrNull(p.card);
      return {
        ...base,
        kind: "discard",
        cards: strArray(d.discarded ?? p.revealed_cards ?? (named ? [named] : [])),
      };
    }

    case "discard_from_pokemon":
      return {
        ...base,
        kind: "discard_from_pokemon",
        card: str(d.card ?? p.card),
        from: str(d.from ?? p.pokemon),
      };

    case "shuffle":
      return { ...base, kind: "shuffle", count: num(d.shuffledIn ?? p.count) };

    case "reveal":
      return { ...base, kind: "reveal", cards: strArray(d.cards ?? p.revealed_cards) };

    case "move_to_hand":
      return {
        ...base,
        kind: "to_hand",
        card: strOrNull(d.card ?? p.card),
        hidden: bool(d.hidden),
      };

    case "add_to_hand":
      return {
        ...base,
        kind: "to_hand",
        card: strOrNull(d.card ?? p.card),
        hidden: false,
      };

    case "mulligan":
      return { ...base, kind: "mulligan", count: num(d.mulligans ?? p.count, 1) };

    case "mulligan_total":
      return { ...base, kind: "mulligan_total", total: num(d.mulligans ?? p.total, 1) };

    case "effect_activated":
      return { ...base, kind: "effect_activated", card: str(d.card ?? p.card) };

    case "opening_hand":
      return { ...base, kind: "opening_hand", handSize: num(d.handSize ?? p.count, 7) };

    case "chose_first": {
      const w = d.firstPlayer;
      return {
        ...base,
        kind: "chose_first",
        firstPlayer: w === "player" || w === "opponent" ? w : null,
      };
    }

    case "turn_start": {
      // detail.turn is the whole TurnState the reducer just installed.
      const turn = (
        typeof d.turn === "object" && d.turn !== null
          ? (d.turn as Record<string, unknown>)
          : {}
      ) as Record<string, unknown>;
      return {
        ...base,
        kind: "turn_start",
        turn: num(turn.number ?? p.turn_number),
        playerTurnNumber: num(turn.playerTurnNumber ?? p.player_turn_number),
      };
    }

    case "turn_end":
      return { ...base, kind: "turn_end" };

    case "coin_flip":
      return {
        ...base,
        kind: "coin_flip",
        stage: "call",
        choice: strOrNull(d.choice ?? p.choice),
      };

    case "coin_toss_won":
      return { ...base, kind: "coin_flip", stage: "won", choice: null };

    case "game_end": {
      // detail.winner is already resolved from handle to side by the
      // reducer; the raw payload only has the handle, so there's nothing
      // useful to fall back to.
      const w = d.winner;
      return {
        ...base,
        kind: "game_end",
        winner: w === "player" || w === "opponent" ? w : null,
        reason: strOrNull(d.reason ?? p.reason),
      };
    }

    default:
      return { ...base, kind: "generic", actionKind: ev.kind };
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Public API                                                       */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Parse + replay a raw TCG Live battle log into its beat stream.
 *
 * Runs the identical pipeline `buildReplayPayload` does — same parse, same
 * perspective normalization, same engine — so a beat's `actionIndex` lines up
 * with the matching frame's by construction. `playerHandle` picks which side
 * the log is normalized to, exactly as it does there.
 *
 * Returned in action order. Note this is NOT frame order: a discard-then-draw
 * exchange and a mulligan run each expand into several frames sharing one
 * actionIndex, so the viewer joins on actionIndex rather than zipping.
 */
export function buildBeats(battleLogRaw: string, playerHandle: string): Beat[] {
  const parsed = parseBattleLog(battleLogRaw);
  const normalized = normalizePerspective(parsed, playerHandle);
  const result = replay(normalized);
  // EngineEvent.actionIndex indexes the normalized action stream, which is
  // what feeds the reducer — so this is the action that produced the event,
  // payload and all.
  return result.events.map((ev) => toBeat(ev, normalized.actions[ev.actionIndex]));
}

/** Beats keyed by actionIndex, for the viewer's per-frame lookup. */
export function indexBeats(beats: Beat[]): Map<number, Beat> {
  return new Map(beats.map((b) => [b.actionIndex, b]));
}

/**
 * What /api/admin/replay2/[battleId] returns: the identical v1 frame payload
 * plus the beat stream. Frames stay authoritative for what's on the board —
 * beats only say how it should be performed.
 */
export interface ReplayPayload2 extends ReplayPayload {
  beats: Beat[];
}
