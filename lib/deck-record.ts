export interface DeckRecord {
  w: number;
  l: number;
  d: number;
  /** wins / (wins + losses) as a whole-number percentage; null when no
   *  decisive games have been logged yet. */
  winRatePct: number | null;
  /** Most recent results first, newest-to-oldest, capped at `recentFormSize`. */
  recentForm: ("W" | "L" | "D")[];
}

const RESULT_LETTER: Record<string, "W" | "L" | "D"> = {
  win: "W",
  loss: "L",
  draw: "D",
};

/**
 * Aggregates raw match rows into a per-deck win/loss/draw record, win rate,
 * and recent-form sequence. Mirrors the win-rate convention used by
 * lib/player-leaderboard.ts (null when there are no decisive games) applied
 * at the deck level instead of the account level.
 */
export function computeDeckRecords(
  matches: { saved_deck_id: string | null; result: string; played_at: string }[],
  recentFormSize = 5,
): Map<string, DeckRecord> {
  const byDeck = new Map<string, { saved_deck_id: string; result: string; played_at: string }[]>();
  for (const m of matches) {
    if (!m.saved_deck_id) continue;
    const list = byDeck.get(m.saved_deck_id) ?? [];
    list.push({ saved_deck_id: m.saved_deck_id, result: m.result, played_at: m.played_at });
    byDeck.set(m.saved_deck_id, list);
  }

  const out = new Map<string, DeckRecord>();
  byDeck.forEach((rows, deckId) => {
    let w = 0;
    let l = 0;
    let d = 0;
    for (const row of rows) {
      if (row.result === "win") w++;
      else if (row.result === "loss") l++;
      else if (row.result === "draw") d++;
    }
    const decisive = w + l;
    const sorted = [...rows].sort(
      (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
    );
    const recentForm = sorted
      .slice(0, recentFormSize)
      .map((row) => RESULT_LETTER[row.result])
      .filter((r): r is "W" | "L" | "D" => r !== undefined);

    out.set(deckId, {
      w,
      l,
      d,
      winRatePct: decisive === 0 ? null : Math.round((w / decisive) * 100),
      recentForm,
    });
  });
  return out;
}
