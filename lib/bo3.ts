/**
 * bo3.ts — Best-of-3 game-sequence helpers for the matches API.
 *
 * game_results is an ordered string of per-game outcomes (W/L), e.g. "WW" or
 * "WLW". The round-level `result` is derived from it server-side so the stored
 * result and the sequence can never disagree.
 */

const GAME_RESULTS_RE = /^[WL]{2,5}$/;

/** Coerce arbitrary input into a normalized sequence string, or null. */
export function normalizeGameResults(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const seq = input.trim().toUpperCase();
  return seq.length > 0 ? seq : null;
}

/** True when the sequence is a valid 2–5 char run of W/L. */
export function isValidGameResults(seq: string): boolean {
  return GAME_RESULTS_RE.test(seq);
}

/** Derive the round result from the per-game sequence (W/L count). */
export function deriveResultFromGames(seq: string): "win" | "loss" | "draw" {
  let wins = 0;
  let losses = 0;
  for (const ch of seq) {
    if (ch === "W") wins++;
    else if (ch === "L") losses++;
  }
  return wins > losses ? "win" : losses > wins ? "loss" : "draw";
}
