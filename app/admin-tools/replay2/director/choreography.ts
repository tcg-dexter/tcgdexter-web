import type { Beat, BeatWeight } from "@/lib/replay2/beats";

/**
 * How long each beat holds the board, and how that time is divided.
 *
 * v1 gave every frame exactly `1000 / speed` ms (ReplayViewer's setInterval).
 * That's the single biggest reason the replay reads flat: a card draw, an
 * evolution and a game-winning attack all take the same second, so nothing
 * can feel more important than anything else. Pacing IS drama — this table is
 * where it's tuned, in one place, for every action type.
 *
 * Beats are also divided into phases. A frame is a single board state, so an
 * attack can't be animated as a sequence of states — but it can be animated
 * as a sequence of *phases* over that one state: the attacker winds up, the
 * blow lands, the board settles. The phase is what lets one frame read as an
 * event rather than a cut, and it's what the FX, camera and audio layers cue
 * off in later milestones.
 */

export type BeatPhase =
  /** Wind-up. Nothing has happened yet; the board leans in. */
  | "anticipate"
  /** The action itself — the card moves, the energy flies, the ability fires. */
  | "act"
  /** The consequence: damage lands, the screen shakes, particles burst. */
  | "impact"
  /** Aftermath and rest. Every beat ends here, and a paused board sits here. */
  | "settle";

export interface PhaseStep {
  phase: BeatPhase;
  /** Unscaled milliseconds. The director divides by playback speed. */
  ms: number;
}

export interface ChoreographySpec {
  phases: PhaseStep[];
}

/** Total unscaled duration of a spec. */
export function specDuration(spec: ChoreographySpec): number {
  return spec.phases.reduce((total, p) => total + p.ms, 0);
}

/**
 * Fallback shape per weight, for any beat without its own entry below.
 *
 * The ambient tier matters as much as the climax one: a battle log is mostly
 * bookkeeping, and holding the board a full second on "shuffled their deck"
 * is what made v1 feel slow at 1× and incoherent at 4×. Ambient beats are
 * meant to slip by almost unnoticed, buying the time back for the moments
 * that deserve it.
 */
const BY_WEIGHT: Record<BeatWeight, ChoreographySpec> = {
  ambient: { phases: [{ phase: "act", ms: 150 }, { phase: "settle", ms: 60 }] },
  normal: {
    phases: [
      { phase: "act", ms: 300 },
      { phase: "settle", ms: 140 },
    ],
  },
  major: {
    phases: [
      { phase: "anticipate", ms: 160 },
      { phase: "act", ms: 400 },
      { phase: "settle", ms: 260 },
    ],
  },
  climax: {
    phases: [
      { phase: "anticipate", ms: 360 },
      { phase: "act", ms: 260 },
      { phase: "impact", ms: 400 },
      { phase: "settle", ms: 620 },
    ],
  },
};

/**
 * Every beat kind's rhythm.
 *
 * Exhaustive by type, not by fallback: `Record<Beat["kind"], …>` means adding
 * a beat kind to beats.ts without deciding how it is paced fails the build.
 * That is the whole point of the breadth pass — the easy failure mode for a
 * table like this is that the dramatic beats get lovingly tuned and the other
 * twenty inherit a default nobody ever looked at, which is exactly how the
 * v1 replay ended up feeling uniform.
 *
 * Most entries still spread a weight's shape; writing them out is what makes
 * an unconsidered one visible.
 */
const BY_KIND: Record<Beat["kind"], ChoreographySpec> = {
  /* ── Climax ──────────────────────────────────────────────────── */

  // The signature moment. A long wind-up is what sells the hit: the pause
  // before the blow is doing more work than the blow.
  attack: {
    phases: [
      { phase: "anticipate", ms: 420 },
      { phase: "act", ms: 240 },
      { phase: "impact", ms: 420 },
      { phase: "settle", ms: 660 },
    ],
  },
  // No wind-up — a knockout is a consequence, and it reads as one by landing
  // immediately and then being given room to breathe.
  knock_out: {
    phases: [
      { phase: "impact", ms: 520 },
      { phase: "settle", ms: 840 },
    ],
  },
  // The longest beat in the replay, deliberately. It is the last thing anyone
  // sees, and cutting away from it at the same pace as a card draw is what
  // makes a replay feel like it stopped rather than ended.
  game_end: {
    phases: [
      { phase: "anticipate", ms: 420 },
      { phase: "impact", ms: 760 },
      { phase: "settle", ms: 1600 },
    ],
  },

  /* ── Board-shape changes ─────────────────────────────────────── */

  // A turn change is a scene change: brief, but it should register as a
  // boundary rather than blur into the action either side of it.
  turn_start: {
    phases: [
      { phase: "act", ms: 320 },
      { phase: "settle", ms: 380 },
    ],
  },
  evolve: {
    phases: [
      { phase: "anticipate", ms: 170 },
      { phase: "act", ms: 420 },
      { phase: "settle", ms: 230 },
    ],
  },
  // Two halves in the log — the retreat pays the cost, a switch_active
  // promotes the replacement — so neither should hold the board for a full
  // major beat or the pair together drags.
  retreat: {
    phases: [
      { phase: "anticipate", ms: 130 },
      { phase: "act", ms: 340 },
      { phase: "settle", ms: 190 },
    ],
  },
  switch_active: {
    phases: [
      { phase: "anticipate", ms: 120 },
      { phase: "act", ms: 380 },
      { phase: "settle", ms: 240 },
    ],
  },
  play_to_slot: {
    phases: [
      { phase: "act", ms: 340 },
      { phase: "impact", ms: 110 },
      { phase: "settle", ms: 170 },
    ],
  },
  prize_taken: {
    phases: [
      { phase: "act", ms: 380 },
      { phase: "settle", ms: 340 },
    ],
  },

  /* ── Turn texture ────────────────────────────────────────────── */

  attach_energy: {
    phases: [
      { phase: "act", ms: 300 },
      { phase: "impact", ms: 120 },
      { phase: "settle", ms: 110 },
    ],
  },
  // Trainers are the busiest line in any log — several a turn. Enough to read
  // the card that was played, and not a millisecond more.
  play_trainer: {
    phases: [
      { phase: "act", ms: 300 },
      { phase: "impact", ms: 100 },
      { phase: "settle", ms: 150 },
    ],
  },
  ability: {
    phases: [
      { phase: "anticipate", ms: 120 },
      { phase: "act", ms: 280 },
      { phase: "settle", ms: 160 },
    ],
  },
  // Needs an impact phase it wouldn't inherit: a condition is something being
  // done TO a Pokémon, and the recoil and the colour pulse both hang off that
  // phase.
  condition: {
    phases: [
      { phase: "act", ms: 220 },
      { phase: "impact", ms: 260 },
      { phase: "settle", ms: 200 },
    ],
  },
  damage_counters: {
    phases: [
      { phase: "act", ms: 160 },
      { phase: "impact", ms: 300 },
      { phase: "settle", ms: 220 },
    ],
  },
  discard_from_pokemon: {
    phases: [
      { phase: "act", ms: 240 },
      { phase: "impact", ms: 140 },
      { phase: "settle", ms: 140 },
    ],
  },
  discard: {
    phases: [
      { phase: "act", ms: 260 },
      { phase: "settle", ms: 130 },
    ],
  },
  // A Stadium firing between turns. It has no actor and often no visible
  // change beyond a damage counter somewhere, so it needs just enough of a
  // beat for the card that caused it to be found on the board.
  effect_activated: {
    phases: [
      { phase: "act", ms: 260 },
      { phase: "impact", ms: 160 },
      { phase: "settle", ms: 160 },
    ],
  },
  // Cheap and constant. Drawing is the metronome of a turn, not an event.
  draw: {
    phases: [
      { phase: "act", ms: 200 },
      { phase: "settle", ms: 70 },
    ],
  },

  /* ── Setup ───────────────────────────────────────────────────── */

  // The one moment before the game where something is genuinely at stake.
  coin_flip: {
    phases: [
      { phase: "anticipate", ms: 260 },
      { phase: "impact", ms: 300 },
      { phase: "settle", ms: 280 },
    ],
  },
  chose_first: {
    phases: [
      { phase: "act", ms: 280 },
      { phase: "settle", ms: 220 },
    ],
  },
  opening_hand: {
    phases: [
      { phase: "act", ms: 420 },
      { phase: "settle", ms: 240 },
    ],
  },
  // A mulligan is a small public misfortune, and the overlay reveals a hand
  // per beat — it needs long enough to actually read the cards.
  mulligan: {
    phases: [
      { phase: "act", ms: 380 },
      { phase: "settle", ms: 420 },
    ],
  },
  // Pure narration ("took 2 mulligans") alongside the reveals that already
  // showed it. Nothing to watch.
  mulligan_total: {
    phases: [
      { phase: "act", ms: 150 },
      { phase: "settle", ms: 60 },
    ],
  },

  /* ── Ambient bookkeeping ─────────────────────────────────────── */
  //
  // These matter as much as the climaxes. A battle log is mostly bookkeeping,
  // and holding the board a full second on "shuffled their deck" is what made
  // v1 feel slow at 1x and incoherent at 4x. They should slip by almost
  // unnoticed and buy the time back for the moments that deserve it.

  shuffle: {
    phases: [
      { phase: "act", ms: 200 },
      { phase: "settle", ms: 70 },
    ],
  },
  reveal: {
    phases: [
      { phase: "act", ms: 240 },
      { phase: "settle", ms: 110 },
    ],
  },
  to_hand: {
    phases: [
      { phase: "act", ms: 180 },
      { phase: "settle", ms: 70 },
    ],
  },
  turn_end: {
    phases: [
      { phase: "act", ms: 140 },
      { phase: "settle", ms: 60 },
    ],
  },
  // The landing spot for parser additions this table hasn't caught up with.
  // Paced, never choreographed — and beats.test.ts fails if a known action
  // type ends up here.
  generic: {
    phases: [
      { phase: "act", ms: 220 },
      { phase: "settle", ms: 110 },
    ],
  },
};

/**
 * A frame that repeats the previous frame's actionIndex.
 *
 * `buildReplayPayload` expands a discard-then-draw exchange into three frames
 * and a mulligan run into one frame per revealed row — same action, same
 * board state, differing only in how much of the overlay is showing. Running
 * the full beat again on each would triple an Ultra Ball. They're continuation
 * beats: enough time to read the newly revealed group, no ceremony.
 */
const CONTINUATION: ChoreographySpec = {
  phases: [
    { phase: "act", ms: 260 },
    { phase: "settle", ms: 120 },
  ],
};

/**
 * A jump — scrub, turn skip, battle load, rewind. There is no performance to
 * give: the board cuts to the destination state (v1's `instant` semantics,
 * preserved), so the beat is over before it starts.
 */
const INSTANT: ChoreographySpec = { phases: [{ phase: "settle", ms: 90 }] };

export function choreographyFor(
  beat: Beat | null,
  opts: { instant?: boolean; continuation?: boolean } = {},
): ChoreographySpec {
  if (opts.instant) return INSTANT;
  if (opts.continuation) return CONTINUATION;
  // No beat at all — frame 0, or a frame whose action the engine never
  // emitted an event for. Paced like ordinary turn texture.
  if (!beat) return BY_WEIGHT.normal;
  return BY_KIND[beat.kind];
}

/** Exposed for the pacing test, which checks the shape of every entry rather
 *  than trusting that each was looked at. */
export const ALL_SPECS: ChoreographySpec[] = Object.values(BY_KIND).concat([
  CONTINUATION,
  INSTANT,
  ...Object.values(BY_WEIGHT),
]);
