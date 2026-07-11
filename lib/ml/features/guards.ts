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
