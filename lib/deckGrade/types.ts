/**
 * Deck Grade v2 — a function-based, play-style-aware deck-quality engine.
 *
 * The engine is pure: it takes a normalized list of deck cards (one entry per
 * unique line, with the catalog fields it needs already resolved) and returns
 * a grade broken into capability axes. Every axis emits a `finding` (the free
 * diagnosis) and a `lever` (the paid-coaching remedy), so the same model backs
 * both the free grade and the future coaching product.
 */

export type PlayStyle = "aggro" | "midrange" | "control" | "toolbox" | "combo";

export const PLAY_STYLE_LABEL: Record<PlayStyle, string> = {
  aggro: "Turbo / Aggro",
  midrange: "Midrange",
  control: "Control / Stall",
  toolbox: "Toolbox / Spread",
  combo: "Combo",
};

/** Functional roles a card can fill in the support engine. */
export type CardRole =
  | "draw"
  | "search"
  | "gust"
  | "switch"
  | "recovery"
  | "accel"
  | "disruption"
  | "stadium";

export type AxisKey =
  | "setup"
  | "energy"
  | "prize"
  | "evolution"
  | "toolbox"
  | "meta";

export type AxisStatus = "good" | "warn" | "weak" | "info";

export interface AxisResult {
  key: AxisKey;
  label: string;
  /** 0–100 achievement on this axis. */
  score: number;
  /** Contribution weight toward the overall grade. 0 = informational. */
  weight: number;
  /** Human-readable target for the axis (e.g. "9–13 energy"). */
  target?: string;
  status: AxisStatus;
  /** Free-tier diagnosis: what's weak and why it matters. */
  finding: string;
  /** Paid-coaching remedy: the concrete fix. Stored but gated in the free UI. */
  lever: string | null;
}

export interface DeckGradeLegality {
  legal: boolean;
  rotatingCount: number;
}

export interface DeckGrade {
  style: PlayStyle;
  styleLabel: string;
  /** 0–1 confidence in the style call (margin between top two style scores). */
  styleConfidence: number;
  total: number;
  grade: string;
  axes: AxisResult[];
  legality: DeckGradeLegality;
}

/**
 * One unique deck line, with the catalog data the engine needs already
 * resolved by the caller (see `buildGradeCards` in the analyze route).
 */
export interface GradeCard {
  name: string;
  qty: number;
  supertype: string; // "Pokémon" | "Trainer" | "Energy" | ...
  subtypes: string[];
  types: string[]; // Pokémon elemental types
  hp: number | null;
  retreatCost: number;
  evolvesFrom: string | null;
  attacks: Array<{ cost: string[]; damage: string }>;
  /** Lowercased ability + attack + rules text — role/effect detection. */
  effectText: string;
  isBasicEnergy: boolean;
  isSpecialEnergy: boolean;
  /** Basic energy → the single type it provides; else []. */
  energyProvides: string[];
}

export interface GradeInput {
  cards: GradeCard[];
  /** From the analyzer's rotation check. */
  legality: DeckGradeLegality;
  /** From the analyzer's metaMatch — informational only. */
  meta?: {
    archetypeName: string | null;
    rank: number | null;
    conversionRate: number | null;
  };
}
