/**
 * Which archetypes can the simulator's AI actually PILOT?
 *
 * W5 asks whether simulated win rates match the real meta; they don't, because
 * one pilot plays both seats and it is far better at some archetypes than
 * others. This asks the narrower question that is actually answerable, and
 * that swap advice actually needs: for THIS deck, does the simulator notice
 * when we remove its best card?
 *
 * A pilot that cannot tell that gutting your deck made it worse has no
 * business telling you which cards to cut. Decks that pass here are decks
 * Dexter's Insight may speak about; decks that fail get silence or a hedge,
 * not a confident wrong answer.
 *
 *   npx tsx scripts/ml/pilot_competence.ts [--n 8] [--decks 10] [--json out.json]
 */

import { writeFileSync } from "node:fs";
import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { simulateMatchup } from "@/lib/engine/sim/rollout";
import { PlannerPolicy } from "@/lib/engine/sim/planner";
import { plannerParamsForSkill } from "@/lib/engine/sim/difficulty";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";
import { lookupCard } from "@/lib/engine/catalog";
import {
  gutDeckList,
  headlineCard,
  judgeCompetence,
  type CompetenceProbe,
} from "@/lib/ml/pilotCompetence";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const N = Number(arg("--n") ?? 8);
const DECKS = Number(arg("--decks") ?? 10);
const FIELD_SIZE = Number(arg("--field") ?? 6);
const JSON_OUT = arg("--json");

interface Entry { name: string; id: string; list: string; rep: number }

function load(): Entry[] {
  const archs = new Map((metaArchetypesRaw as { id: string; name: string; representation_pct: number }[]).map((a) => [a.id, a]));
  const out: Entry[] = [];
  for (const raw of metaDecksRaw as (MetaDeckEntry & { id: string; variants?: { cards: unknown[] }[] })[]) {
    const a = archs.get(raw.id);
    if (!a) continue;
    const cards = raw.cards?.length ? raw.cards : (raw.variants?.[0]?.cards as MetaDeckEntry["cards"]) ?? [];
    const list = metaDeckToList({ ...raw, cards } as MetaDeckEntry);
    if (!list) continue;
    out.push({ name: a.name, id: raw.id, list, rep: a.representation_pct });
  }
  return out.sort((x, y) => y.rep - x.rep);
}

/** The bot plays with the TRAINED value model when one is available. Both
 *  harnesses previously constructed PlannerPolicy without an `evaluate`
 *  option, so every calibration run silently fell back to the planner's
 *  built-in heuristicEvaluator — i.e. we were measuring the meta with the
 *  weakest pilot we own while value-gbm-v1 sat unused. */
const EVALUATOR = createBotEvaluator() ?? undefined;

const params = plannerParamsForSkill(1);

/** Seat-balanced win rate of `list` against `field`. */
function vsField(list: string, field: Entry[], seed: string): number {
  let wins = 0;
  let games = 0;
  for (const f of field) {
    for (const flipped of [false, true]) {
      const [a, b] = flipped ? [f.list, list] : [list, f.list];
      const r = simulateMatchup(a, b, {
        n: N,
        seed: `${seed}:${f.id}:${flipped}`,
        policies: (gameSeed: number) => ({
          player: new PlannerPolicy({ params, seed: gameSeed, evaluate: EVALUATOR }),
          opponent: new PlannerPolicy({ params, seed: (gameSeed ^ 0x85ebca6b) >>> 0, evaluate: EVALUATOR }),
        }),
      });
      wins += flipped ? N - r.wins_a : r.wins_a;
      games += N;
    }
  }
  return games > 0 ? wins / games : 0;
}

function main(): void {
  const all = load();
  const field = all.slice(0, FIELD_SIZE);
  const subjects = all.slice(0, DECKS);
  const hp = (name: string) => lookupCard(name)?.hp ?? null;

  console.log(`Pilot-competence probe — ${subjects.length} decks vs a ${field.length}-deck field, ${N} games/pairing/seed\n`);
  console.log("deck                    key card               base%  gutted%   delta   verdict");
  console.log("-".repeat(88));

  const results: unknown[] = [];
  for (const d of subjects) {
    const key = headlineCard(d.list, hp, d.name);
    if (!key) continue;
    const gutted = gutDeckList(d.list, key);
    const probes: CompetenceProbe[] = [];
    for (const seed of ["pc-a", "pc-b"]) {
      const base = vsField(d.list, field, `${seed}:${d.id}:base`);
      const g = vsField(gutted, field, `${seed}:${d.id}:gut`);
      probes.push({ base, gutted: g, deltaPoints: (g - base) * 100 });
    }
    const verdict = judgeCompetence(probes);
    const p0 = probes[0];
    console.log(
      `${d.name.slice(0, 22).padEnd(24)}${key.slice(0, 22).padEnd(23)}` +
        `${(p0.base * 100).toFixed(1).padStart(5)}  ${(p0.gutted * 100).toFixed(1).padStart(7)}  ` +
        `${verdict.meanDeltaPoints.toFixed(1).padStart(6)}   ${verdict.competent ? "OK" : "NOT PILOTED"}`,
    );
    if (!verdict.competent) console.log(`${" ".repeat(24)}└─ ${verdict.reason}`);
    results.push({ deck: d.name, id: d.id, key, ...verdict });
  }

  const ok = results.filter((r) => (r as { competent: boolean }).competent).length;
  console.log(`\n${ok}/${results.length} archetypes are piloted well enough to advise on.`);
  console.log("Decks that fail are NOT decks with bad lists — they are decks the");
  console.log("simulator cannot play, and it must say so rather than grade them.");
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }
}

main();
