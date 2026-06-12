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

/* ─── Prizes ─────────────────────────────────────────────────── */

/** Prizes taken in a single game: player (p) and opponent (o), 0–6 or null. */
export interface GamePrize {
  p: number | null;
  o: number | null;
}

/** Clamp a prize count to an integer 0–6, or null when absent/invalid. */
export function sanitizePrize(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(6, Math.trunc(n)));
}

/**
 * Validate a per-game prize array (Best-of-3). Returns the sanitized array, or
 * null when the input isn't an array or no prizes were actually recorded.
 */
export function sanitizeGamePrizes(value: unknown): GamePrize[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: GamePrize[] = value.slice(0, 5).map((g) => ({
    p: sanitizePrize((g as { p?: unknown } | null)?.p),
    o: sanitizePrize((g as { o?: unknown } | null)?.o),
  }));
  return out.some((g) => g.p !== null || g.o !== null) ? out : null;
}
