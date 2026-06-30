// Card-ID handling for the verbose ("elaborate") TCG Live battle-log export.
//
// TCG Live has a setting that prefixes every card name in the log with its
// set code + collector number, e.g.
//
//   a11father played (me2-5_155) N's Zekrom to the Active Spot.
//   a11father's (me2-5_154_ph2) N's Reshiram is now in the Active Spot.
//
// The standard export omits these prefixes. We strip them so the existing
// name-based patterns and catalog lookups work for both formats, and we
// surface the captured id so the exact printing can be resolved (the id
// disambiguates same-name cards that the name-only heuristic can't).
//
// An id is "(<set>_<number>[_<suffix>])": a set code (letters / digits /
// hyphens), an underscore, then a number that may carry a variant suffix
// (e.g. "_ph2"). The required underscore inside the parentheses is what keeps
// real card names — which never contain "(word_word)" — from matching.

const ID_BODY = "[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*";
/** Matches a leading "(<id>) " prefix; capture group 1 is the bare id. */
const LEADING_ID_RE = new RegExp(`^\\((${ID_BODY})\\)\\s*`);
/** Matches every "(<id>) " prefix in a line, for raw-text cleanup. */
const GLOBAL_ID_RE = new RegExp(`\\((${ID_BODY})\\)\\s*`, "g");

/** Split a captured card value into its clean name and the leading id (or
 *  null when the value carries no id — i.e. the standard export). */
export function splitCardId(value: string): { name: string; id: string | null } {
  const m = value.match(LEADING_ID_RE);
  if (!m) return { name: value.trim(), id: null };
  return { name: value.slice(m[0].length).trim(), id: m[1] };
}

/** Remove all "(<id>) " prefixes from a free-text line (used to keep the
 *  stored raw_text readable for both formats). */
export function stripCardIds(text: string): string {
  return text.replace(GLOBAL_ID_RE, "");
}
