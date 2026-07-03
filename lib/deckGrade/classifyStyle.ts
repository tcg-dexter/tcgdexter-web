import type { GradeCard, PlayStyle } from "./types";
import { hasRole, roleCopies } from "./roles";
import {
  evolutionStage,
  isAttacker,
  sumQty,
  topDamage,
} from "./helpers";

export interface StyleFeatures {
  energyCount: number;
  attackerLines: number;
  maxAttackerCopies: number;
  basicAttackerRatio: number;
  maxStage: number;
  avgTopDamage: number;
  maxHp: number;
  disruptionCopies: number;
  hasAccel: boolean;
  hasRecovery: boolean;
}

export function extractFeatures(cards: GradeCard[]): StyleFeatures {
  const pokemon = cards.filter((c) => c.supertype === "Pokémon");
  const attackers = pokemon.filter(isAttacker);

  const attackerLines = attackers.length;
  const maxAttackerCopies = attackers.reduce((m, c) => Math.max(m, c.qty), 0);
  const basicAttackerCopies = sumQty(attackers, (c) => evolutionStage(c) === 0);
  const totalAttackerCopies = sumQty(attackers, () => true);
  const basicAttackerRatio =
    totalAttackerCopies > 0 ? basicAttackerCopies / totalAttackerCopies : 0;

  const maxStage = pokemon.reduce((m, c) => Math.max(m, evolutionStage(c)), 0);
  const damages = attackers.map(topDamage).filter((d) => d > 0);
  const avgTopDamage =
    damages.length > 0 ? damages.reduce((s, d) => s + d, 0) / damages.length : 0;
  const maxHp = pokemon.reduce((m, c) => Math.max(m, c.hp ?? 0), 0);

  return {
    energyCount: sumQty(cards, (c) => c.supertype === "Energy"),
    attackerLines,
    maxAttackerCopies,
    basicAttackerRatio,
    maxStage,
    avgTopDamage,
    maxHp,
    disruptionCopies: roleCopies(cards, "disruption"),
    hasAccel: hasRole(cards, "accel"),
    hasRecovery: hasRole(cards, "recovery"),
  };
}

export interface StyleCall {
  style: PlayStyle;
  confidence: number;
  features: StyleFeatures;
}

/**
 * Nearest-profile style classification. Each style gets a heuristic score from
 * the deck's own structure; the winner is the style, and confidence is the
 * margin over the runner-up. Midrange carries a baseline so it wins when no
 * archetype signal is strong.
 */
export function classifyStyle(cards: GradeCard[]): StyleCall {
  const f = extractFeatures(cards);

  const scores: Record<PlayStyle, number> = {
    aggro: 0,
    midrange: 0.35, // baseline default
    control: 0,
    toolbox: 0,
    combo: 0,
  };

  // Aggro: low, fast, mostly-Basic attackers hitting hard.
  if (f.maxStage <= 1) scores.aggro += 0.3;
  if (f.basicAttackerRatio >= 0.6) scores.aggro += 0.25;
  if (f.energyCount <= 9 || f.hasAccel) scores.aggro += 0.2;
  if (f.avgTopDamage >= 120) scores.aggro += 0.2;

  // Control / Stall: disruption-heavy, or grindy walls with low damage.
  if (f.disruptionCopies >= 3) scores.control += 0.6;
  if (f.disruptionCopies >= 5) scores.control += 0.15;
  if (f.avgTopDamage > 0 && f.avgTopDamage < 110) scores.control += 0.2;
  if (f.maxHp >= 300 && f.hasRecovery) scores.control += 0.2;

  // Toolbox / Spread: many shallow attacker lines.
  if (f.attackerLines >= 4) scores.toolbox += 0.35;
  if (f.maxAttackerCopies <= 2 && f.attackerLines >= 3) scores.toolbox += 0.25;

  // Combo: conservative — a deep engine feeding few attackers.
  if (f.attackerLines <= 2 && f.maxStage >= 2 && f.hasAccel) scores.combo += 0.3;

  // Midrange gets a nudge when it looks like a focused evolution deck.
  if (f.maxStage >= 1 && f.attackerLines >= 1 && f.attackerLines <= 3) {
    scores.midrange += 0.15;
  }

  const ranked = (Object.entries(scores) as Array<[PlayStyle, number]>).sort(
    (a, b) => b[1] - a[1],
  );
  const [style, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const confidence = top > 0 ? Math.max(0, Math.min(1, (top - second) / top)) : 0;

  return { style, confidence, features: f };
}
