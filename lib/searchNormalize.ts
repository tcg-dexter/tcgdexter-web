/**
 * Lowercase and strip diacritics so "pokémon" and "pokemon" — or "flabébé"
 * and "flabebe" — fold to the same search key. Apply to both indexed text
 * and the user's query before comparing.
 */
export function normalizeForSearch(s: string): string {
  // NFD splits "é" into "e" + U+0301 (combining acute). Stripping the
  // combining-marks range (U+0300–U+036F) folds it back to plain "e".
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
