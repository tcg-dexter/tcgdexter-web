import { Fragment } from "react";

/** Per-side aggregate stats for a single match. Sourced from
 *  match_actions rows and shared between the /battles detail page and
 *  the /matches Featured Match drawer so the two surfaces render the
 *  same numbers. */
export interface BattleSideStats {
  damage: number;
  pokemon: number;
  supporters: number;
  items: number;
  energy: number;
  prizes: number;
}

/** Per-stat table: one row per stat, one column per player. Numbers
 *  carry the comparison — the leader on each row is bolded a touch
 *  heavier so the eye still lands on it without a bar telling you to.
 *  Row dividers span the entire grid width (col-span-3) so the
 *  separators read as one continuous line rather than three column
 *  segments. */
export function BattleStatChart({
  playerName,
  opponentName,
  winnerSide,
  rows,
}: {
  playerName: string;
  opponentName: string;
  winnerSide: "left" | "right" | null;
  rows: { label: string; left: number; right: number }[];
}) {
  const leftGradient = winnerSide === "left";
  const rightGradient = winnerSide === "right";
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-baseline">
      {/* Column headers */}
      <div />
      <div className={`pb-2 text-[11px] font-bold truncate text-right tabular-nums ${leftGradient ? "bg-gradient-brand bg-clip-text text-transparent" : "text-text-primary"}`}>
        {playerName}
      </div>
      <div className={`pb-2 text-[11px] font-bold truncate text-right tabular-nums ${rightGradient ? "bg-gradient-brand bg-clip-text text-transparent" : "text-text-primary"}`}>
        {opponentName}
      </div>

      {rows.map((row, idx) => {
        const isFirst = idx === 0;
        const isFooter = idx === rows.length - 1;
        return (
          <Fragment key={row.label}>
            {!isFirst && (
              <div className={`col-span-3 border-t ${isFooter ? "border-black" : "border-black/[0.08]"}`} />
            )}
            <div className={`font-semibold uppercase tracking-widest text-text-primary py-2.5 ${isFooter ? "text-[14px]" : "text-[11px]"}`}>
              {row.label}
            </div>
            <div className={`py-2.5 text-right tabular-nums font-semibold text-text-secondary ${isFooter ? "text-[18px]" : "text-sm"}`}>
              {row.left}
            </div>
            <div className={`py-2.5 text-right tabular-nums font-semibold text-text-secondary ${isFooter ? "text-[18px]" : "text-sm"}`}>
              {row.right}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Builds the six stat rows in the canonical order the battle page uses.
 *  Kept here rather than at the call sites so both surfaces stay in sync
 *  if row labels or order ever shift. */
export function buildBattleStatRows(
  playerStats: BattleSideStats,
  opponentStats: BattleSideStats,
): { label: string; left: number; right: number }[] {
  return [
    { label: "Damage Dealt", left: playerStats.damage, right: opponentStats.damage },
    { label: "Pokémon Played", left: playerStats.pokemon, right: opponentStats.pokemon },
    { label: "Supporters Played", left: playerStats.supporters, right: opponentStats.supporters },
    { label: "Items Played", left: playerStats.items, right: opponentStats.items },
    { label: "Energy Attached", left: playerStats.energy, right: opponentStats.energy },
    { label: "Prizes Taken", left: playerStats.prizes, right: opponentStats.prizes },
  ];
}
