// Resolve a Pokémon name to its LimitlessTCG gen-9 sprite URL.
//
// Card names carry trainer-owner prefixes ("N's ", "Giovanni's "), the "Mega "
// prefix, and rarity suffixes (" ex", " V", " VMAX", …) that the sprite slug
// doesn't; strip them to land on the base species slug the sprite CDN uses.

export function pokemonSpriteUrl(name: string): string {
  const slug = name
    .toLowerCase()
    // Strip possessive trainer-name prefixes ("N's ", "Giovanni's ", etc.)
    // before apostrophes are removed so the pattern still recognises them.
    .replace(/^[a-z0-9]+['’']s\s+/i, "")
    // Strip "Mega " prefix used for Mega Evolution card names.
    .replace(/^mega\s+/i, "")
    .replace(/['’'.,]/g, "")
    .replace(/\s+(ex|v|vmax|vstar|gx)\b/gi, "")
    .trim()
    .replace(/\s+/g, "-");
  return `https://r2.limitlesstcg.net/pokemon/gen9/${slug}.png`;
}
