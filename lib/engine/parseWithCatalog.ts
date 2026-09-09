import { parseBattleLog } from "@/lib/battle-log";
import type { BattleLogParseResult } from "@/lib/battle-log";
import { isAttackName } from "./catalog";

/**
 * `parseBattleLog` with the card catalog lent to it — the entry point every
 * SERVER-side caller should use.
 *
 * The parser can't import the catalog itself: it also runs in the browser
 * (the battle-log import preview), and the catalog pulls in a 15 MB card
 * database. Everything that persists actions, drives the board, or feeds the
 * ML/coach pipelines runs on the server, where that cost is a one-time read,
 * so they go through here and get the one decision the raw text can't make:
 * whether "<handle>'s <Pokémon> used <move>." is an attack or an ability.
 *
 * Calling plain `parseBattleLog` is not a bug — it degrades to the older
 * behavior, in which targetless attacks read as abilities — but on the
 * server it is always the worse answer.
 */
export function parseBattleLogWithCatalog(raw: string): BattleLogParseResult {
  return parseBattleLog(raw, { isAttackName });
}
