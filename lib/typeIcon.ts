const KNOWN_TYPES = new Set([
  "Fire",
  "Water",
  "Grass",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Fairy",
  "Colorless",
]);

export function typeIconUrl(type: string | undefined | null): string | null {
  if (!type || !KNOWN_TYPES.has(type)) return null;
  return `/types/${type.toLowerCase()}.png`;
}
