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
 * Per-kind overrides, for beats whose rhythm is specific rather than just
 * "a major thing happened". Anything absent falls through to BY_WEIGHT.
 */
const BY_KIND: Partial<Record<Beat["kind"], ChoreographySpec>> = {
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
  game_end: {
    phases: [
      { phase: "anticipate", ms: 400 },
      { phase: "impact", ms: 700 },
      { phase: "settle", ms: 1400 },
    ],
  },
  // A turn change is a scene change: brief, but it should register as a
  // boundary rather than blur into the action either side of it.
  turn_start: {
    phases: [
      { phase: "act", ms: 320 },
      { phase: "settle", ms: 380 },
    ],
  },
  // Cheap and constant. Drawing is the metronome of a turn, not an event.
  draw: { phases: [{ phase: "act", ms: 200 }, { phase: "settle", ms: 70 }] },
  attach_energy: {
    phases: [
      { phase: "act", ms: 300 },
      { phase: "impact", ms: 120 },
      { phase: "settle", ms: 110 },
    ],
  },
  evolve: {
    phases: [
      { phase: "anticipate", ms: 170 },
      { phase: "act", ms: 420 },
      { phase: "settle", ms: 230 },
    ],
  },
  prize_taken: {
    phases: [
      { phase: "act", ms: 380 },
      { phase: "settle", ms: 340 },
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
  if (!beat) return BY_WEIGHT.normal;
  return BY_KIND[beat.kind] ?? BY_WEIGHT[beat.weight];
}
