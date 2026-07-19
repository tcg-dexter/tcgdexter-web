// Community deck pool for self-play: user-saved decks, not the curated meta
// archetype list. Sourced from the SAME feature_store.sqlite that
// dexter-ml's ml_export.py already snapshots Supabase's `saved_decks` table
// into — no new Supabase coupling here, just reading a local sqlite file.
//
// Scope is deliberately PUBLIC decks only: there is no privacy policy / ToS
// disclosure anywhere in this app covering aggregate ML use of saved deck
// data. A public deck is one the user already chose to expose; a private
// one has no such signal. Widening this to private decks later is a product
// decision (a consent/disclosure addition), not a flag flip here.
//
// Anonymized by construction: the only thing this module returns is deck
// list text plus a content-hash id. No user_id, deck id, or deck name ever
// leaves loadCommunityDecks.

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { instantiateDeck, SimDeckError } from "@/lib/engine/sim";

export interface CommunityDeck {
  /** `community:<sha256 prefix of the normalized deck list>` — content
   *  addressed, never derived from the row's own id/user_id/name. */
  id: string;
  list: string;
}

function normalize(deckList: string): string {
  return deckList
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort()
    .join("\n");
}

function isLegal(deckList: string): boolean {
  try {
    const deck = instantiateDeck(deckList);
    return deck.deckSize === 60 && deck.unknownNames.length === 0;
  } catch (e) {
    if (e instanceof SimDeckError) return false;
    throw e;
  }
}

/** Loads the public, legal, deduplicated community deck pool from
 *  `storePath` (the shared feature_store.sqlite). Deterministically ordered
 *  by id so callers can cap/sample reproducibly. */
export function loadCommunityDecks(storePath: string): CommunityDeck[] {
  const db = new DatabaseSync(storePath, { readOnly: true });
  let rows: { deck_list: string; raw: string }[];
  try {
    rows = db
      .prepare("SELECT deck_list, raw FROM saved_decks")
      .all() as { deck_list: string; raw: string }[];
  } finally {
    db.close();
  }

  const seen = new Set<string>();
  const decks: CommunityDeck[] = [];
  for (const row of rows) {
    if (!row.deck_list) continue;
    let isPublic = false;
    try {
      isPublic = JSON.parse(row.raw)?.is_public === true;
    } catch {
      continue; // malformed raw row — skip rather than guess
    }
    if (!isPublic) continue;
    if (!isLegal(row.deck_list)) continue;

    const normalized = normalize(row.deck_list);
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
    if (seen.has(hash)) continue; // exact-content duplicate (forks/clones)
    seen.add(hash);
    decks.push({ id: `community:${hash}`, list: row.deck_list });
  }

  decks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return decks;
}
