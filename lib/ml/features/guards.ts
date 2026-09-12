// NaN / Infinity guards for feature rows. Feature values must be finite
// numbers or null — never NaN, Infinity, or undefined (JSONL consumers in
// dexter-ml treat null as missing; NaN would silently poison training).

/** Coerce to a finite number, else the fallback (default 0). */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce to a finite number, else null. Null/undefined stay null. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Encode truthiness as 0 | 1. */
export function bool01(v: unknown): 0 | 1 {
  return v ? 1 : 0;
}

/** Mean of a list, null when empty (never NaN). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Walk a flat row and return the paths of any non-finite numeric values or
 * undefined fields. Used by tests (must be empty) and by the extract CLI
 * as a belt-and-braces check before writing JSONL.
 */
export function findInvalidValues(row: Record<string, unknown>): string[] {
  const bad: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) bad.push(`${key}=undefined`);
    else if (typeof value === "number" && !Number.isFinite(value)) {
      bad.push(`${key}=${value}`);
    }
  }
  return bad;
}

/** Parse a CLI `--seed` that may be a NUMBER or a LABEL.
 *
 *  Every seeded harness here used `numOrNull(arg("--seed")) ?? <default>`,
 *  which returns null for a non-numeric string and silently falls back to the
 *  default. A sweep over "run-a", "run-b", … therefore ran the SAME games
 *  every time and pooled them into a confident, TIGHTER-than-real interval —
 *  no error, no warning, and the only symptom is byte-identical rows. That
 *  produced a fake 10-seed result in this project before it was caught.
 *
 *  A label is hashed to a number, so `--seed bo3-main` is a real, distinct,
 *  reproducible seed rather than a synonym for the default. `hash` is passed
 *  in (rather than imported) to keep this module free of engine deps. */
export function seedOrLabel(
  raw: string | null | undefined,
  fallback: number,
  hash: (s: string) => number,
): number {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : hash(raw);
}
