/**
 * W5 — the calibration gate.
 *
 * Coverage says the engine KNOWS what every card does. This asks the only
 * question that actually matters for grading: does simulating the meta
 * reproduce the real meta? We simulate the full round-robin between the 30
 * canonical archetype lists, weight each deck's results by how much of the
 * real field it faces, and correlate that against the real tournament record.
 *
 * GO/NO-GO: Spearman >= 0.7 (does the sim RANK archetypes like reality?),
 * with RMSE on win% as a secondary read. Rank correlation is the primary
 * because a systematic offset (the sim being uniformly swingier than paper,
 * say) is calibratable; getting the ORDER wrong is not.
 *
 * Seat balance is not optional. simulateMatchup already alternates who goes
 * first, but deck A always occupies the "player" seat, and value_gate.ts
 * documents how a seat/initiative confound once faked a result. So every
 * pairing is simulated in BOTH orders and averaged — deck i's record vs j
 * combines its wins as A in (i,j) with its wins as B in (j,i).
 *
 *   npx tsx scripts/ml/calibration.ts [--n 60] [--seed cal-1] [--json out.json]
 */

import { writeFileSync } from "node:fs";
import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { simulateMatchup } from "@/lib/engine/sim/rollout";
import { PlannerPolicy, plannerParamsForSkill, SIM_VERSION } from "@/lib/engine/sim";
import { deckEffectCoverage } from "@/lib/ml/effectCoverage";

/* ─── CLI ───────────────────────────────────────────────────────── */

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const N = Number(arg("--n") ?? 60);
const SEED = arg("--seed") ?? "calibration-v1";
const JSON_OUT = arg("--json");
/** Which AI pilots both decks. Real results come from expert humans, so a
 *  weak pilot is itself a calibration error: decks that need setup (Stage-2
 *  lines, combo) are under-rated purely because the AI can't assemble them. */
const POLICY = (arg("--policy") ?? "heuristic") as "heuristic" | "planner";
const SKILL = Number(arg("--skill") ?? 1);
/** Minimum DECIDED real games for an archetype to be scored. Half the field
 *  has <100: Mega Diancie's "25% win rate" is 1 win in 4 games. Correlating
 *  against that treats coin-flip noise as ground truth and swamps the signal
 *  from Dragapult's 1,886 games. Fringe decks are still SIMULATED (they are
 *  part of the field every deck faces) — they're just not scored. */
const MIN_GAMES = Number(arg("--min-games") ?? 100);

/* ─── Inputs ────────────────────────────────────────────────────── */

interface Archetype {
  id: string;
  name: string;
  representation_pct: number;
  conversion_rate: number;
  wins: number;
  losses: number;
  ties: number;
}

interface Deck {
  id: string;
  name: string;
  list: string;
  arch: Archetype;
  /** Real win rate, ties excluded (the standard convention). */
  realWinRate: number;
  /** Share of the field this archetype represents. */
  weight: number;
  coverage: number;
  /** Real decided games behind realWinRate — the reliability of this row. */
  decided: number;
}

function loadDecks(): Deck[] {
  const archetypes = new Map(
    (metaArchetypesRaw as Archetype[]).map((a) => [a.id, a]),
  );
  const out: Deck[] = [];
  for (const raw of metaDecksRaw as (MetaDeckEntry & { id: string; name: string; variants?: { cards: unknown[] }[] })[]) {
    const arch = archetypes.get(raw.id);
    if (!arch) continue;
    const cards = raw.cards?.length ? raw.cards : (raw.variants?.[0]?.cards as MetaDeckEntry["cards"]) ?? [];
    const list = metaDeckToList({ ...raw, cards } as MetaDeckEntry);
    if (!list) continue;
    const decided = arch.wins + arch.losses;
    if (decided === 0) continue; // no real record at all
    out.push({
      decided,
      id: raw.id,
      name: raw.name,
      list,
      arch,
      realWinRate: arch.wins / decided,
      weight: arch.representation_pct,
      coverage: deckEffectCoverage(list).fraction,
    });
  }
  return out;
}

/* ─── Statistics ────────────────────────────────────────────────── */

/** Ranks with ties averaged (required for a correct Spearman on tied values). */
function rank(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));

function rmse(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
}

/* ─── Simulation ────────────────────────────────────────────────── */

interface MatrixCell {
  /** Deck i's win rate vs deck j, averaged across BOTH seats. */
  winRate: number;
  games: number;
}

function runMatrix(decks: Deck[]): {
  matrix: MatrixCell[][];
  endReasons: Record<string, number>;
  avgTurns: number;
} {
  const size = decks.length;
  // winsAsA[i][j] = deck i's wins when seated as A against j.
  const winsAsA: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const endReasons: Record<string, number> = {};
  let turnSum = 0;
  let matchups = 0;
  const started = Date.now();

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // A mirror is 50% by definition — simulating it only adds noise, but it
      // IS part of the real field, so it stays in the weighting below.
      if (i === j) {
        winsAsA[i][j] = N / 2;
        continue;
      }
      const r = simulateMatchup(decks[i].list, decks[j].list, {
        n: N,
        seed: `${SEED}:${decks[i].id}:${decks[j].id}`,
        ...(POLICY === "planner"
          ? {
              policies: (gameSeed: number) => ({
                player: new PlannerPolicy({ params: plannerParamsForSkill(SKILL), seed: gameSeed }),
                opponent: new PlannerPolicy({
                  params: plannerParamsForSkill(SKILL),
                  seed: (gameSeed ^ 0x85ebca6b) >>> 0,
                }),
              }),
            }
          : {}),
      });
      winsAsA[i][j] = r.wins_a;
      for (const [k, v] of Object.entries(r.end_reasons)) {
        endReasons[k] = (endReasons[k] ?? 0) + v;
      }
      turnSum += r.avg_turns;
      matchups++;
    }
    const pct = (((i + 1) / size) * 100).toFixed(0);
    process.stderr.write(`\r  simulating… ${pct}%  (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  process.stderr.write("\n");

  // Seat-balanced combine: deck i's record vs j = its wins as A in (i,j)
  // plus its wins as B in (j,i) — which are the games A did NOT win there.
  const matrix: MatrixCell[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null).map(() => ({ winRate: 0.5, games: 0 })),
  );
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) {
        matrix[i][j] = { winRate: 0.5, games: N };
        continue;
      }
      const winsSeatA = winsAsA[i][j];
      const winsSeatB = N - winsAsA[j][i]; // deck i as B
      matrix[i][j] = { winRate: (winsSeatA + winsSeatB) / (2 * N), games: 2 * N };
    }
  }
  return { matrix, endReasons, avgTurns: matchups > 0 ? turnSum / matchups : 0 };
}

/** Win rate vs the field, weighting each opponent by how often it's faced. */
function fieldWinRate(row: MatrixCell[], decks: Deck[]): number {
  let num = 0;
  let den = 0;
  for (let j = 0; j < decks.length; j++) {
    const w = decks[j].weight;
    num += w * row[j].winRate;
    den += w;
  }
  return den > 0 ? num / den : 0.5;
}

/* ─── Report ────────────────────────────────────────────────────── */

function main(): void {
  const decks = loadDecks();
  console.log(`\n=== W5 calibration (SIM_VERSION ${SIM_VERSION}) ===`);
  console.log(`  ${decks.length} archetypes · ${N} games/pairing/seat · seed "${SEED}" · policy ${POLICY}${POLICY === "planner" ? ` (skill ${SKILL})` : ""}`);
  const pairings = decks.length * (decks.length - 1);
  console.log(`  ${pairings} ordered pairings → ${(pairings * N).toLocaleString()} games\n`);

  const { matrix, endReasons, avgTurns } = runMatrix(decks);

  const allRows = decks.map((d, i) => {
    const sim = fieldWinRate(matrix[i], decks);
    return { deck: d, sim, real: d.realWinRate, delta: sim - d.realWinRate };
  });
  // Every deck is simulated (it's part of the field); only well-sampled ones
  // are SCORED.
  const rows = allRows.filter((r) => r.deck.decided >= MIN_GAMES);

  const simArr = rows.map((r) => r.sim);
  const realArr = rows.map((r) => r.real);
  const rho = spearman(simArr, realArr);
  const r2 = pearson(simArr, realArr);
  const err = rmse(simArr, realArr);

  console.log(`  scoring ${rows.length}/${allRows.length} archetypes with >= ${MIN_GAMES} decided real games\n`);
  console.log("  archetype              share   cov    sim%    real%    delta   n");
  console.log("  " + "-".repeat(62));
  for (const r of [...allRows].sort((a, b) => b.deck.weight - a.deck.weight)) {
    const d = (r.delta * 100).toFixed(1).padStart(6);
    console.log(
      `  ${r.deck.name.slice(0, 20).padEnd(20)} ${(r.deck.weight * 100).toFixed(1).padStart(5)}% ` +
        `${(r.deck.coverage * 100).toFixed(0).padStart(4)}% ` +
        `${(r.sim * 100).toFixed(1).padStart(6)}% ${(r.real * 100).toFixed(1).padStart(7)}% ${d}` +
        `  ${String(r.deck.decided).padStart(5)}${r.deck.decided < MIN_GAMES ? " *" : ""}`,
    );
  }

  console.log("\n  === correlation vs real tournament results ===");
  console.log(`  Spearman (rank):   ${rho.toFixed(3)}   [GATE: >= 0.700]`);
  console.log(`  Pearson  (linear): ${r2.toFixed(3)}`);
  console.log(`  RMSE on win%:      ${(err * 100).toFixed(2)} points`);
  console.log(`  Sim spread:        ${(Math.min(...simArr) * 100).toFixed(1)}% – ${(Math.max(...simArr) * 100).toFixed(1)}%`);
  console.log(`  Real spread:       ${(Math.min(...realArr) * 100).toFixed(1)}% – ${(Math.max(...realArr) * 100).toFixed(1)}%`);

  console.log("\n  === sanity signals ===");
  console.log(`  avg turns/game:    ${avgTurns.toFixed(1)}`);
  const totalGames = Object.values(endReasons).reduce((s, v) => s + v, 0);
  for (const [k, v] of Object.entries(endReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  end ${k.padEnd(14)} ${((v / totalGames) * 100).toFixed(1)}%`);
  }

  console.log("\n  === worst residuals (where the sim disagrees most) ===");
  for (const r of [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6)) {
    const dir = r.delta > 0 ? "sim TOO HIGH" : "sim TOO LOW ";
    console.log(
      `  ${r.deck.name.slice(0, 22).padEnd(22)} ${dir} by ${(Math.abs(r.delta) * 100).toFixed(1)} pts` +
        `  (sim ${(r.sim * 100).toFixed(1)}% vs real ${(r.real * 100).toFixed(1)}%)`,
    );
  }

  const pass = rho >= 0.7;
  console.log(`\n  ${pass ? "PASS" : "FAIL"} — Spearman ${rho.toFixed(3)} ${pass ? ">=" : "<"} 0.700\n`);

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          sim_version: SIM_VERSION,
          n: N,
          seed: SEED,
          policy: POLICY,
          min_games: MIN_GAMES,
          spearman: rho,
          pearson: r2,
          rmse: err,
          pass,
          rows: rows.map((r) => ({
            id: r.deck.id,
            name: r.deck.name,
            weight: r.deck.weight,
            coverage: r.deck.coverage,
            sim: r.sim,
            real: r.real,
            delta: r.delta,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`  wrote ${JSON_OUT}\n`);
  }
  process.exit(pass ? 0 : 1);
}

main();
