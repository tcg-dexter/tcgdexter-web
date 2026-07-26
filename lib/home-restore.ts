/**
 * Tiny helper around sessionStorage for the "anonymous user pasted a deck,
 * clicked Save/Share, was bounced to /sign-in" flow. After auth, the home
 * page reads the stash to pre-fill the textarea so the user doesn't lose
 * their work.
 *
 * We stash only the deck list string (cheap, well under the ~5MB session
 * cap). The analysis is re-derived client-side via /api/analyze when the
 * user re-triggers the action, so we don't need to persist it.
 */

const KEY = "tcgdex.home.deckList";
const INTENT_KEY = "tcgdex.home.deckIntent";

/** What the user was trying to do when they hit the sign-in wall. Drives
 *  what happens after they return to the home page with the deck restored:
 *  "save" auto-completes the save they'd already clicked; anything else just
 *  pre-fills the textarea. */
export type DeckIntent = "save" | "share";

export function stashDeckList(deckList: string, intent?: DeckIntent) {
  try {
    sessionStorage.setItem(KEY, deckList);
    if (intent) sessionStorage.setItem(INTENT_KEY, intent);
    else sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // sessionStorage can throw in private mode; the worst case is the user
    // has to re-paste, which is acceptable.
  }
}

/** True when a deck list is stashed (read-only — does not consume it). Used
 *  by onboarding to decide whether to send the user back to the home page to
 *  finish the save they started, vs. their profile. */
export function hasStashedDeckList(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function popDeckList(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value !== null) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}

/** Reads and clears the stashed intent (see {@link DeckIntent}). Read this
 *  alongside popDeckList when restoring so a stale intent can't leak into a
 *  later, unrelated paste. */
export function popDeckIntent(): DeckIntent | null {
  try {
    const value = sessionStorage.getItem(INTENT_KEY);
    if (value !== null) sessionStorage.removeItem(INTENT_KEY);
    return value === "save" || value === "share" ? value : null;
  } catch {
    return null;
  }
}
