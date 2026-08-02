/**
 * W5 diagnostic — WHY do simulated games stall?
 *
 * Calibration says 20% of games end in deck-out, which essentially never
 * happens in real Pokémon. A deck-out means the AI spent 60 cards without
 * taking 6 prizes: it is either failing to attack, attacking for too little,
 * or burning deck on draw/search it doesn't convert.
 *
 * This walks real games with the driver's observer seam and reports the
 * per-turn shape of play: how often a side had an attack available, how
 * often it took one, how fast energy accumulates, and where the deck goes.
 *
 *   npx tsx scripts/ml/turn_probe.ts [--n 40] [--decks 6] [--seed probe-1]
 */

import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { instantiateDeck } from "@/lib/engine/sim/setup";
import { playGame, type TurnObservation } from "@/lib/engine/sim/driver";
import { HeuristicPolicy } from "@/lib/engine/sim/policy";
import { PlannerPolicy } from "@/lib/engine/sim/planner";
import { plannerParamsForSkill } from "@/lib/engine/sim/difficulty";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";
import { hashSeed, mulberry32 } from "@/lib/engine/sim/rng";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const N = Number(arg("--n") ?? 40);
const DECKS = Number(arg("--decks") ?? 6);
const SEED = arg("--seed") ?? "probe-1";
/** Which pilot to profile. The planner is what the gameplay UI actually uses,
 *  so its turn shape is the one that matters for "does the AI play well". */
const POLICY = arg("--policy") ?? "heuristic";
const EVALUATOR = createBotEvaluator() ?? undefined;
const PARAMS = plannerParamsForSkill(1);
const makePolicy = (seed: number) =>
  POLICY === "planner"
    ? new PlannerPolicy({ params: PARAMS, seed, evaluate: EVALUATOR })
    : new HeuristicPolicy();

interface Arch { id: string; name: string; representation_pct: number }

function loadDecks(): { name: string; list: string }[] {
  const archetypes = new Map((metaArchetypesRaw as Arch[]).map((a) => [a.id, a]));
  const out: { name: string; list: string; rep: number }[] = [];
  for (const raw of metaDecksRaw as (MetaDeckEntry & { id: string; name: string; variants?: { cards: unknown[] }[] })[]) {
    const arch = archetypes.get(raw.id);
    if (!arch) continue;
    const cards = raw.cards?.length ? raw.cards : (raw.variants?.[0]?.cards as MetaDeckEntry["cards"]) ?? [];
    const list = metaDeckToList({ ...raw, cards } as MetaDeckEntry);
    if (!list) continue;
    out.push({ name: arch.name, list, rep: arch.representation_pct });
  }
  out.sort((a, b) => b.rep - a.rep);
  return out.slice(0, DECKS);
}

const GOLDEN = 0x9e3779b9;

function main(): void {
  const decks = loadDecks();
  console.log(`Probing ${decks.length} decks x ${N} games/pairing\n`);

  const obs: TurnObservation[] = [];
  const endReasons: Record<string, number> = {};
  const gameTurns: number[] = [];
  // Per-deck aggregate, keyed by deck name.
  const perDeck = new Map<string, { turns: number; attacked: number; attackAvail: number; prizes: number; games: number }>();

  for (let i = 0; i < decks.length; i++) {
    for (let j = 0; j < decks.length; j++) {
      if (i === j) continue;
      const deckA = instantiateDeck(decks[i].list);
      const deckB = instantiateDeck(decks[j].list);
      const base = hashSeed(`${SEED}:${i}:${j}`);
      for (let g = 0; g < N; g++) {
        const rng = mulberry32((base + Math.imul(g + 1, GOLDEN)) >>> 0);
        const local: TurnObservation[] = [];
        const out = playGame(
          deckA,
          deckB,
          { player: makePolicy(g + 1), opponent: makePolicy(g + 9001) },
          rng,
          g % 2 === 0 ? "player" : "opponent",
          { observer: (ev) => { local.push(ev); } },
        );
        obs.push(...local);
        endReasons[out.endReason] = (endReasons[out.endReason] ?? 0) + 1;
        gameTurns.push(out.turns);
        for (const [seat, name] of [["player", decks[i].name], ["opponent", decks[j].name]] as const) {
          const mine = local.filter((o) => o.actor === seat);
          const rec = perDeck.get(name) ?? { turns: 0, attacked: 0, attackAvail: 0, prizes: 0, games: 0 };
          rec.turns += mine.length;
          rec.attacked += mine.filter((o) => o.attacked).length;
          rec.attackAvail += mine.filter((o) => o.attacksAvailable > 0).length;
          rec.prizes += out.prizesTaken[seat];
          rec.games += 1;
          perDeck.set(name, rec);
        }
      }
    }
  }

  const total = obs.length;
  const attacked = obs.filter((o) => o.attacked).length;
  const hadAttack = obs.filter((o) => o.attacksAvailable > 0).length;
  const noActive = obs.filter((o) => o.activeName === null).length;

  console.log("=== GAME SHAPE ===");
  const games = gameTurns.length;
  console.log(`games ${games}  avg turns ${(gameTurns.reduce((s, v) => s + v, 0) / games).toFixed(1)}`);
  for (const [r, c] of Object.entries(endReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(10)} ${((c / games) * 100).toFixed(1)}%  (${c})`);
  }

  // How CLOSE were deck-out games to finishing on prizes? A deck-out at 5
  // prizes is a real (if rare) Pokemon ending; one at 1-2 prizes means the AI
  // spun its wheels for 25 turns and never threatened.
  const lastByGame = new Map<number, TurnObservation>();
  console.log("\n=== TURN SHAPE ===");
  console.log(`turns observed        ${total}`);
  console.log(`had a legal attack    ${((hadAttack / total) * 100).toFixed(1)}%`);
  console.log(`actually attacked     ${((attacked / total) * 100).toFixed(1)}%`);
  console.log(`  ...when one existed ${((attacked / Math.max(1, hadAttack)) * 100).toFixed(1)}%`);
  console.log(`no active Pokemon     ${((noActive / total) * 100).toFixed(1)}%`);

  const couldAttach = obs.filter((o) => o.attachAvailable).length;
  const attachedMoves = obs.filter((o) => o.moves.includes("attach")).length;
  console.log(`could attach energy   ${((couldAttach / total) * 100).toFixed(1)}%`);
  console.log(`actually attached     ${((attachedMoves / total) * 100).toFixed(1)}%`);
  console.log(`  ...when one existed ${((attachedMoves / Math.max(1, couldAttach)) * 100).toFixed(1)}%`);

  console.log("\n=== BY TURN NUMBER (own-turn index) ===");
  console.log("t   n      deck  hand  bench  energy  eHand  maxE  eMons  canAtch%  atch%  hasAtk%  atk%");
  const byIdx = new Map<number, TurnObservation[]>();
  for (const o of obs) {
    // own-turn index: turn 1,2 are the two players' first turns, etc.
    const idx = Math.ceil(o.turn / 2);
    if (idx > 16) continue;
    (byIdx.get(idx) ?? byIdx.set(idx, []).get(idx)!).push(o);
  }
  for (const idx of Array.from(byIdx.keys()).sort((a, b) => a - b)) {
    const rows = byIdx.get(idx)!;
    const avg = (f: (o: TurnObservation) => number) => rows.reduce((s, o) => s + f(o), 0) / rows.length;
    const pct = (f: (o: TurnObservation) => boolean) => (rows.filter(f).length / rows.length) * 100;
    console.log(
      `${String(idx).padEnd(3)} ${String(rows.length).padEnd(6)} ` +
      `${avg((o) => o.deckCount).toFixed(1).padStart(5)} ` +
      `${avg((o) => o.handCount).toFixed(1).padStart(5)} ` +
      `${avg((o) => o.benchCount).toFixed(1).padStart(6)} ` +
      `${avg((o) => o.energyInPlay).toFixed(1).padStart(7)} ` +
      `${avg((o) => o.energyInHand).toFixed(1).padStart(6)} ` +
      `${avg((o) => o.maxEnergyOnOneMon).toFixed(1).padStart(5)} ` +
      `${avg((o) => o.monsWithEnergy).toFixed(1).padStart(6)} ` +
      `${pct((o) => o.attachAvailable).toFixed(0).padStart(9)} ` +
      `${pct((o) => o.moves.includes("attach")).toFixed(0).padStart(6)} ` +
      `${pct((o) => o.attacksAvailable > 0).toFixed(0).padStart(8)} ` +
      `${pct((o) => o.attacked).toFixed(0).padStart(5)}`,
    );
  }

  console.log(`invariant backstop fired on ${((obs.filter((o) => o.invariantFixes > 0).length / total) * 100).toFixed(1)}% of turns`);
  const noAct = obs.filter((o) => o.activeName === null);
  console.log(`  of those, bench empty ${((noAct.filter((o) => o.benchCount === 0).length / Math.max(1, noAct.length)) * 100).toFixed(1)}%`);
  console.log(`  of those, bench>0     ${((noAct.filter((o) => o.benchCount > 0).length / Math.max(1, noAct.length)) * 100).toFixed(1)}%`);

  console.log("\n=== DECLINED AT PASS (legal but not taken; % of passing turns) ===");
  const passing = obs.filter((o) => o.declinedAtPass.length > 0);
  const declined = new Map<string, number>();
  for (const o of passing) {
    for (const k of Array.from(new Set(o.declinedAtPass))) declined.set(k, (declined.get(k) ?? 0) + 1);
  }
  console.log(`passing turns with legal moves left: ${passing.length} / ${total}`);
  for (const [k, c] of Array.from(declined.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${((c / Math.max(1, passing.length)) * 100).toFixed(1)}%`);
  }

  console.log("\n=== MOVE MIX (per turn, mean count) ===");
  const kindTotals = new Map<string, number>();
  for (const o of obs) for (const k of o.moves) kindTotals.set(k, (kindTotals.get(k) ?? 0) + 1);
  for (const [k, c] of Array.from(kindTotals.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${(c / total).toFixed(2)}`);
  }

  console.log("\n=== BY DECK ===");
  console.log("deck                              atk%  atkAvail%  prizes/game");
  for (const [name, r] of Array.from(perDeck.entries()).sort((a, b) => a[1].attacked / a[1].turns - b[1].attacked / b[1].turns)) {
    console.log(
      `${name.slice(0, 32).padEnd(34)}` +
      `${((r.attacked / r.turns) * 100).toFixed(0).padStart(4)}  ` +
      `${((r.attackAvail / r.turns) * 100).toFixed(0).padStart(9)}  ` +
      `${(r.prizes / r.games).toFixed(2).padStart(11)}`,
    );
  }
}

main();
