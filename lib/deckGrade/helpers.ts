import type { GradeCard } from "./types";

/** Top HP tier in current Standard (meaty two-prize ex's sit ~330–340). A KO
 *  threat needs to threaten this number. Kept a constant so the engine stays
 *  pure/testable; can be wired to the live catalog HP distribution later. */
export const FORMAT_TOP_HP = 340;

/** Leading integer of a damage string ("120+", "50×", "" → 120, 50, 0). */
export function parseDamage(damage: string | undefined): number {
  if (!damage) return 0;
  const m = damage.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Non-Colorless energy types this card's attacks require (deduped). */
export function attackCostTypes(card: GradeCard): string[] {
  const out = new Set<string>();
  for (const atk of card.attacks) {
    for (const t of atk.cost) {
      if (t && t !== "Colorless") out.add(t);
    }
  }
  return Array.from(out);
}

/** A Pokémon that has at least one damage-dealing attack. */
export function isAttacker(card: GradeCard): boolean {
  return (
    card.supertype === "Pokémon" &&
    card.attacks.some((a) => parseDamage(a.damage) > 0)
  );
}

/** Highest single-attack damage this Pokémon can output. */
export function topDamage(card: GradeCard): number {
  return card.attacks.reduce((m, a) => Math.max(m, parseDamage(a.damage)), 0);
}

const MULTI_PRIZE_SUBTYPES = ["ex", "v", "vstar", "gx"];

/** Prizes an opponent takes for KO'ing this Pokémon (VMAX = 3, ex/V/… = 2). */
export function prizeValue(card: GradeCard): number {
  const subs = card.subtypes.map((s) => s.toLowerCase());
  if (subs.includes("vmax")) return 3;
  if (subs.some((s) => MULTI_PRIZE_SUBTYPES.includes(s))) return 2;
  return 1;
}

export function isMultiPrize(card: GradeCard): boolean {
  return prizeValue(card) >= 2;
}

/** Evolution stage: 0 Basic, 1 Stage 1, 2 Stage 2. */
export function evolutionStage(card: GradeCard): number {
  const subs = card.subtypes.map((s) => s.toLowerCase());
  if (subs.includes("stage 2")) return 2;
  if (subs.includes("stage 1")) return 1;
  return 0;
}

/**
 * Probability the opening 7-card hand contains at least one of `copies`
 * matching cards, drawn from a `deckSize`-card deck. Hypergeometric, product
 * form to avoid large binomials.
 */
export function pAtLeastOneInOpening(
  copies: number,
  deckSize: number,
  handSize = 7,
): number {
  if (copies <= 0 || deckSize <= 0) return 0;
  if (deckSize - copies < handSize) return 1;
  let pNone = 1;
  for (let i = 0; i < handSize; i++) {
    pNone *= (deckSize - copies - i) / (deckSize - i);
  }
  return 1 - pNone;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Sum of qty across a predicate. */
export function sumQty(cards: GradeCard[], pred: (c: GradeCard) => boolean): number {
  return cards.reduce((s, c) => (pred(c) ? s + c.qty : s), 0);
}
