/**
 * Basic-energy name aliases.
 *
 * The bundled card DB stores basic energies under two unrelated keys:
 *   - "Lightning Energy"        → legacy + holo prints (base, gym, sm1 SUM,
 *                                 sm2 GRI gold, swsh7 EVS, …)
 *   - "Basic Lightning Energy"  → modern Scarlet/Violet prints (SVI 257,
 *                                 SVE 4, SVE 12)
 *
 * TCG Live decklists use the `Basic {L} Energy SUM 196` form, which by
 * itself only matches the "Basic Lightning Energy" key — so any legacy or
 * gold/secret-rare basic energy print silently falls back to SVE 4.
 *
 * Resolvers (cardPrinting.pickPrinting, deckTiles.resolveEntry) should call
 * `basicEnergyAliasKeys(name)` to get every name-key the same energy might
 * be filed under, and merge the candidate pools before matching set+number.
 */

const ENERGY_SYMBOL_TO_TYPE: Record<string, string> = {
  R: "Fire",
  W: "Water",
  G: "Grass",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  Y: "Fairy",
  N: "Dragon",
  C: "Colorless",
};

const BASIC_ENERGY_TYPES = new Set([
  "fire",
  "water",
  "grass",
  "lightning",
  "psychic",
  "fighting",
  "darkness",
  "metal",
  "fairy",
]);

/**
 * Return every lowercased name key under which a basic energy might appear
 * in the card DB, given a single decklist-style name. Returns null if the
 * input doesn't look like a basic energy.
 *
 * Examples:
 *   "Basic {L} Energy"       → ["basic lightning energy", "lightning energy"]
 *   "Lightning Energy"       → ["basic lightning energy", "lightning energy"]
 *   "Basic Lightning Energy" → ["basic lightning energy", "lightning energy"]
 */
export function basicEnergyAliasKeys(name: string): string[] | null {
  const trimmed = name.trim();

  const symbolMatch = trimmed.match(/^Basic\s+\{([A-Z])\}\s+Energy$/i);
  if (symbolMatch) {
    const type = ENERGY_SYMBOL_TO_TYPE[symbolMatch[1].toUpperCase()];
    return type
      ? [`basic ${type.toLowerCase()} energy`, `${type.toLowerCase()} energy`]
      : null;
  }

  const basicMatch = trimmed.match(/^Basic\s+([A-Za-z]+)\s+Energy$/i);
  if (basicMatch) {
    const type = basicMatch[1].toLowerCase();
    if (BASIC_ENERGY_TYPES.has(type)) {
      return [`basic ${type} energy`, `${type} energy`];
    }
  }

  const bareMatch = trimmed.match(/^([A-Za-z]+)\s+Energy$/);
  if (bareMatch) {
    const type = bareMatch[1].toLowerCase();
    if (BASIC_ENERGY_TYPES.has(type)) {
      return [`basic ${type} energy`, `${type} energy`];
    }
  }

  return null;
}
