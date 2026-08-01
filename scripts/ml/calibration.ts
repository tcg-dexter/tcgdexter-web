/**
 * W5 — the calibration gate.
 *
 * Coverage says the engine KNOWS what every card does. This asks the only
 * question that actually matters for grading: does simulating the meta
 * reproduce the real meta? We simulate the full round-robin between the 30
 * canonical archetype lists, weight each deck's results by how much of the
 * real field it faces, and correlate that against the real tournament record.
 *
 * GO/NO-GO: RMSE on win% <= 10 points (primary), plus Spearman at >= 80% of
 * what the real data can support (secondary).
 *
 * The gate was originally "Spearman >= 0.7", which was a mistake: nobody
 * checked whether the ground truth could support it. The 16 scored archetypes
 * span 46.6%-58.1% with a median ~270 decided games, so adjacent decks differ
 * by less than their own sampling error. Split-half resampling puts the
 * ceiling for a PERFECT simulator at about 0.66 — BELOW the old bar. It could
 * never have passed. `realDataCeiling` now computes that ceiling from the
 * data at runtime and the rank gate is stated relative to it.
 *
 * Seat balance is not optional. simulateMatchup already alternates who goes
 * first, but deck A always occupies the "player" seat, and value_gate.ts
 * documents how a seat/initiative confound once faked a result. So every
 * pairing is simulated in BOTH orders and averaged — deck i's record vs j
 * combines its wins as A in (i,j) with its wins as B in (j,i).
 *
 *   npx tsx scripts/ml/calibration.ts [--n 60] [--seed cal-1] [--json out.json]
 *
 * ON READING THE OUTPUT: this harness is NOISY at small --n. Two runs of the
 * identical build at --n 8 differed by 0.085 Spearman and 1.0 RMSE point
 * (seeds cal-p / cal-q). Do not attribute a change of that size to whatever
 * you just edited — A/B a change at --n 40+, or across several seeds, or you
 * will chase noise. Measured, after doing exactly that.
 */

import { writeFileSync } from "node:fs";
import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { simulateMatchup } from "@/lib/engine/sim/rollout";
import { PlannerPolicy, plannerParamsForSkill, SIM_VERSION } from "@/lib/engine/sim";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";
import { deckEffectCoverage } from "@/lib/ml/effectCoverage";
import { mulberry32 } from "@/lib/engine/sim/rng";
import { evaluateCalibration } from "@/lib/ml/deckGradeCalibration";

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
 *  lines, combo) are under-rated purely because the AI can't assemble them.
 *
 *  Defaults to the PLANNER, and that default is a measured decision, not a
 *  preference. Piloted by the heuristic the field correlates at Spearman
 *  0.094; by the planner, 0.303. Grading a deck against a pilot that cannot
 *  play it is measuring the pilot, so the gate uses the strongest one we
 *  have. (`--policy heuristic` still runs the cheap version for quick loops.)
 *
 *  Worth recording: the planner scored WORSE than the heuristic (-0.157) when
 *  this was first measured. What changed in between was the engine — a rules
 *  violation was leaving a side with no Active Pokémon on 12.6% of turns, and
 *  lookahead cannot help when the rules underneath it are wrong. */
const POLICY = (arg("--policy") ?? "planner") as "heuristic" | "planner";
const SKILL = Number(arg("--skill") ?? 2);
/** Minimum DECIDED real games for an archetype to be scored. Half the field
 *  has <100: Mega Diancie's "25% win rate" is 1 win in 4 games. Correlating
 *  against that treats coin-flip noise as ground truth and swamps the signal
 *  from Dragapult's 1,886 games. Fringe decks are still SIMULATED (they are
 *  part of the field every deck faces) — they're just not scored. */
const MIN_GAMES = Number(arg("--min-games") ?? 100);
/** Primary gate: mean absolute error on win%, in fractional points. "Within
 *  10 points of the real measurement" is the product-level bar — it is what a
 *  deck grade claims when it says a list wins about X% against the field. */
const RMSE_GATE = Number(arg("--rmse-gate") ?? 0.10);
/** Planner lookahead: re-rank the top-K plans by simulating our follow-up
 *  turn. Defaults OFF in the engine (DEFAULT_DEEPEN_TOP_K = 0) because it did
 *  not pay with the heuristic evaluator; worth re-testing now the trained
 *  value model is actually in the loop.
 *
 *  TESTED: --deepen 4 gives slope 0.028 / out-of-sample skill -8%, against
 *  0.036 / -6% with deepening off. No evidence it helps even with the trained
 *  evaluator, which is consistent with why the engine defaults it to 0. Kept
 *  as a flag so the re-test is one command, not a code change. */
const DEEPEN = Number(arg("--deepen") ?? 0);
/** Secondary gate: rank correlation, as a FRACTION of what the real data can
 *  support. Expressed as a fraction because the absolute number is bounded by
 *  sampling noise in the ground truth, not by the simulator. */
const RANK_GATE_FRACTION = Number(arg("--rank-fraction") ?? 0.8);
/** How many real list variants per archetype to average over. 1 reproduces
 *  the old single-canonical-list behaviour. */
const VARIANTS_PER_DECK = Number(arg("--variants") ?? 3);

/** The bot plays with the TRAINED value model when one is available. Both
 *  harnesses previously constructed PlannerPolicy without an `evaluate`
 *  option, so every calibration run silently fell back to the planner's
 *  built-in heuristicEvaluator — i.e. we were measuring the meta with the
 *  weakest pilot we own while value-gbm-v1 sat unused. */
const EVALUATOR = createBotEvaluator() ?? undefined;

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
  /** Canonical list — used for coverage and as the single-variant fallback. */
  list: string;
  /** Real variants of this archetype, sampled per rollout. */
  lists: string[];
  arch: Archetype;
  /** Real win rate, ties excluded (the standard convention). */
  realWinRate: number;
  /** Share of the field this archetype represents. */
  weight: number;
  coverage: number;
  /** Real decided games behind realWinRate — the reliability of this row. */
  decided: number;
}


/* ─── How much signal does the ground truth actually contain? ────── */

/** Split-half reliability of the real record, by binomial resampling.
 *
 *  This exists because the original gate (Spearman >= 0.7) was set without
 *  asking whether the data could support it. The 16 scored archetypes span
 *  46.6%-58.1% real win rate with a median of ~270 decided games, so adjacent
 *  decks differ by less than their own sampling error. Drawing each
 *  archetype's rate twice from its OWN observed distribution and correlating
 *  the two draws measures the ground truth's agreement with itself.
 *
 *  If two draws correlate at rho, then a PERFECT simulator — which produces
 *  the true probability rather than a second noisy draw — correlates with the
 *  observed sample at about sqrt(rho). That is the real ceiling, and no
 *  amount of engine work can exceed it. */
function realDataCeiling(
  decks: { wins: number; decided: number }[],
  trials = 400,
): { attainableSpearman: number; rmseFloor: number } {
  const rng = mulberry32(0x5eed);
  const draw = (n: number, p: number) => {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < p) k += 1;
    return k / n;
  };
  let rhoSum = 0;
  let errSum = 0;
  for (let t = 0; t < trials; t++) {
    const a: number[] = [];
    const b: number[] = [];
    for (const d of decks) {
      const p = d.wins / Math.max(1, d.decided);
      a.push(draw(d.decided, p));
      b.push(draw(d.decided, p));
    }
    rhoSum += spearman(a, b);
    errSum += rmse(a, b);
  }
  const splitHalf = rhoSum / trials;
  return {
    attainableSpearman: Math.sqrt(Math.max(0, splitHalf)),
    // Two noisy draws differ by sqrt(2)x what one noisy draw differs from truth.
    rmseFloor: errSum / trials / Math.SQRT2,
  };
}

function loadDecks(): Deck[] {
  const archetypes = new Map(
    (metaArchetypesRaw as Archetype[]).map((a) => [a.id, a]),
  );
  const out: Deck[] = [];
  for (const raw of metaDecksRaw as (MetaDeckEntry & { id: string; name: string; variants?: { cards: unknown[] }[] })[]) {
    const arch = archetypes.get(raw.id);
    if (!arch) continue;
    // Every archetype ships MULTIPLE real variants (up to 12) and we used
    // only variants[0]. The tournament record being correlated against is the
    // aggregate of all of them, so simulating one canonical list measures a
    // different population than the ground truth does. Sample up to
    // VARIANTS_PER_DECK of them and average.
    const variantCards: MetaDeckEntry["cards"][] = [];
    if (raw.cards?.length) variantCards.push(raw.cards);
    for (const v of raw.variants ?? []) {
      if (Array.isArray(v?.cards) && v.cards.length) {
        variantCards.push(v.cards as MetaDeckEntry["cards"]);
      }
    }
    const lists = variantCards
      .slice(0, VARIANTS_PER_DECK)
      .map((cards) => metaDeckToList({ ...raw, cards } as MetaDeckEntry))
      .filter((l): l is string => Boolean(l));
    if (lists.length === 0) continue;
    const list = lists[0];
    const decided = arch.wins + arch.losses;
    if (decided === 0) continue; // no real record at all
    out.push({
      decided,
      id: raw.id,
      name: raw.name,
      list,
      lists,
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
      // Pair the variants off (variant v of A vs variant v of B) rather than
      // crossing them: crossing is quadratic in variants for no extra signal,
      // since what we want is the AVERAGE over real lists, not every pairing.
      const pairs = Math.max(decks[i].lists.length, decks[j].lists.length);
      const perPair = Math.max(1, Math.round(N / pairs));
      let wins = 0;
      let played = 0;
      let turnsAcc = 0;
      let turnsN = 0;
      for (let v = 0; v < pairs; v++) {
        const listA = decks[i].lists[v % decks[i].lists.length];
        const listB = decks[j].lists[v % decks[j].lists.length];
        const r = simulateMatchup(listA, listB, {
          n: perPair,
          seed: `${SEED}:${decks[i].id}:${decks[j].id}:${v}`,
          ...(POLICY === "planner"
            ? {
                policies: (gameSeed: number) => ({
                  player: new PlannerPolicy({ params: plannerParamsForSkill(SKILL), seed: gameSeed, evaluate: EVALUATOR, deepenTopK: DEEPEN }),
                  opponent: new PlannerPolicy({
                    params: plannerParamsForSkill(SKILL),
                    seed: (gameSeed ^ 0x85ebca6b) >>> 0,
                    evaluate: EVALUATOR,
                    deepenTopK: DEEPEN,
                  }),
                }),
              }
            : {}),
        });
        wins += r.wins_a;
        played += perPair;
        turnsAcc += r.avg_turns;
        turnsN += 1;
        for (const [k, val] of Object.entries(r.end_reasons)) {
          endReasons[k] = (endReasons[k] ?? 0) + val;
        }
      }
      // Normalise back onto the N-game scale the matrix below assumes.
      winsAsA[i][j] = (wins / Math.max(1, played)) * N;
      turnSum += turnsAcc / Math.max(1, turnsN);
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

  const ceiling = realDataCeiling(
    rows.map((r) => ({ wins: r.deck.arch.wins, decided: r.deck.decided })),
  );

  // THE NULL MODEL: predict the field mean for every deck. It knows nothing —
  // no cards, no rules, no simulation — and it scores RMSE ~3.2 here, because
  // the real win rates only span 46.6%-58.1%. Any RMSE bar loose enough to be
  // reachable is therefore ALSO reachable by saying "every deck is average",
  // and shrinking simulated win rates toward the mean would "pass" while
  // adding no information at all. This line exists so that can never be
  // mistaken for progress — including by whoever is tempted next.
  const nullPred = realArr.reduce((sum, v) => sum + v, 0) / realArr.length;
  const nullErr = rmse(realArr.map(() => nullPred), realArr);
  // Fraction of the null model's error the simulator removes. Negative means
  // the simulation is worse than assuming every deck is average.
  const skill = 1 - err / nullErr;

  console.log("\n  === correlation vs real tournament results ===");
  console.log(
    `  Spearman (rank):   ${rho.toFixed(3)}   [ceiling ${ceiling.attainableSpearman.toFixed(3)}` +
      ` — ${((rho / Math.max(1e-9, ceiling.attainableSpearman)) * 100).toFixed(0)}% of attainable]`,
  );
  console.log(`  Pearson  (linear): ${r2.toFixed(3)}`);
  console.log(
    `  RMSE on win%:      ${(err * 100).toFixed(2)} points   ` +
      `[GATE: <= ${(RMSE_GATE * 100).toFixed(0)}, floor ${(ceiling.rmseFloor * 100).toFixed(2)}]`,
  );
  console.log(`  RMSE, null model:  ${(nullErr * 100).toFixed(2)} points   [predict ${(nullPred * 100).toFixed(1)}% for EVERY deck]`);

  // A raw simulated win rate is a model SCORE, not a prediction — the sim
  // spans 26%-83% where reality spans 46.6%-58.1%. Fitting a link function is
  // ordinary practice; fitting it and then scoring the fit is not, and when
  // the simulator has no signal the fit degenerates to the null model. So
  // this is LEAVE-ONE-OUT: every deck is predicted by a fit that never saw
  // it, and the null baseline is held to the same rule.
  const cal = evaluateCalibration(
    rows.map((r) => ({ sim: r.sim, real: r.real, label: r.deck.name })),
  );
  console.log("\n  === calibrated prediction (leave-one-out) ===");
  console.log(`  fit:               real = ${cal.fullFit.intercept.toFixed(3)} + ${cal.fullFit.slope.toFixed(3)} x sim`);
  console.log(`  RMSE out-of-sample ${cal.rmsePoints.toFixed(2)} points   [null, same protocol: ${cal.nullRmsePoints.toFixed(2)}]`);
  console.log(
    `  SKILL out-of-sample ${(cal.skill * 100).toFixed(0)}%   ` +
      (cal.skill > 0
        ? "(calibrated simulation beats knowing nothing)"
        : "(no better than knowing nothing)"),
  );
  console.log(
    `  SKILL vs null:     ${(skill * 100).toFixed(0)}%   ` +
      (skill > 0
        ? "(the simulation carries information)"
        : "(WORSE than assuming every deck is average)"),
  );
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

  // PRIMARY gate is absolute error, not rank. Two reasons. First, it is the
  // question the product actually asks: a deck grade says "this list wins
  // about X% against the field", and being 15 points off is wrong in a way
  // users would notice. Second, rank correlation is capped by the ground
  // truth's own noise (see realDataCeiling) — the old >= 0.700 bar sat ABOVE
  // what a flawless simulator could score against this sample, so it could
  // never have passed, no matter how good the engine got.
  const rankOk = rho >= RANK_GATE_FRACTION * ceiling.attainableSpearman;
  const errOk = err <= RMSE_GATE;
  // Beating the null model is non-negotiable: without it a low RMSE only
  // means we learned to say "average", which is not a deck grade.
  const skillOk = skill > 0;
  const pass = errOk && rankOk && skillOk;
  if (!skillOk) {
    console.log(
      `\n  !! The null model beats the simulator by ${((err - nullErr) * 100).toFixed(1)} points.` +
        `\n     Do NOT close this gap by shrinking simulated win rates toward the mean —` +
        `\n     that reproduces the null model exactly. It closes by RANKING decks correctly,` +
        `\n     i.e. by play quality (Spearman ${rho.toFixed(3)} of ${ceiling.attainableSpearman.toFixed(3)} attainable).`,
    );
  }
  console.log(
    `\n  ${pass ? "PASS" : "FAIL"} — RMSE ${(err * 100).toFixed(2)}pts ` +
      `${errOk ? "<=" : ">"} ${(RMSE_GATE * 100).toFixed(0)} (primary), ` +
      `Spearman ${rho.toFixed(3)} ${rankOk ? ">=" : "<"} ` +
      `${(RANK_GATE_FRACTION * ceiling.attainableSpearman).toFixed(3)} ` +
      `(${(RANK_GATE_FRACTION * 100).toFixed(0)}% of the ${ceiling.attainableSpearman.toFixed(3)} attainable)\n`,
  );

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
