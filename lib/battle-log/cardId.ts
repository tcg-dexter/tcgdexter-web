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

// Payload fields that hold a single card name, across every action type.
export const CARD_NAME_FIELDS = [
  "card",
  "energy",
  "target",
  "from",
  "to",
  "pokemon",
  "source",
  "attacker",
  "defender",
] as const;
// Payload fields that hold a list of card names.
export const CARD_NAME_ARRAY_FIELDS = [
  "revealed_cards",
  "replaced_stadium",
  "discarded_energies",
  "discarded_cards",
  "drawn_cards",
  // Legacy alias of discarded_cards on ability_used. Listed so the verbose
  // export's id prefixes get stripped from it too — they never were.
  "discards",
] as const;

/** Payload fields holding an array of { cards: string[] } groups — one
 *  card-name array nested inside each element, rather than the flat list
 *  CARD_NAME_ARRAY_FIELDS expects. mulligan / mulligan_total's per-mulligan
 *  reveals are the one case of this shape today. */
export const CARD_NAME_GROUPED_FIELDS = ["mulligan_reveals"] as const;

/** Return a copy of an action payload with card-id prefixes stripped from its
 *  card-name fields. Used at display time to clean actions that were parsed
 *  and persisted before the verbose-export id stripping landed. */
export function cleanPayloadCardIds(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const f of CARD_NAME_FIELDS) {
    if (typeof out[f] === "string") out[f] = splitCardId(out[f] as string).name;
  }
  for (const f of CARD_NAME_ARRAY_FIELDS) {
    const v = out[f];
    if (Array.isArray(v)) {
      out[f] = v.map((x) => (typeof x === "string" ? splitCardId(x).name : x));
    }
  }
  return out;
}
