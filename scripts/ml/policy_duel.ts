// Policy-ranker duel CLI: RankerPolicy (a policy artifact) vs PlannerPolicy,
// head-to-head over meta decks. The promotion gate for policy models — a
// candidate artifact must beat (or approach) the planner here before it is
// worth enabling in the registry.
//
// Sides and first actor both alternate on a fixed schedule, and every game
// is seeded from (seed, gameIndex), so a (artifact, skill, games, seed,
// decks) tuple reproduces the same result exactly.
//
// Usage:
//   npm run ml:duel -- [--artifact PATH] [--skill 1.0] [--games N]
//                      [--seed S] [--decks M] [--max-turns T]
//                      [--temperature T]

import path from "node:path";

import metaDecksRaw from "@/data/meta-decks.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import {
  PlannerPolicy,
  hashSeed,
  instantiateDeck,
  mulberry32,
  playGame,
  plannerParamsForSkill,
  type GameOutcome,
} from "@/lib/engine/sim";
import { numOrNull } from "@/lib/ml/features";
import { readPolicyArtifactFile } from "@/lib/ml/policyModel";
import { RankerPolicy } from "@/lib/ml/rankerPolicy";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";

/* ─── CLI args ──────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const artifactPath = path.resolve(
  REPO_ROOT,
  argValue("--artifact") ?? path.join("data", "ml", "policy.json"),
);
const skill = numOrNull(argValue("--skill")) ?? 1.0;
const games = numOrNull(argValue("--games")) ?? 100;
const seed = numOrNull(argValue("--seed")) ?? 1;
const deckCount = numOrNull(argValue("--decks")) ?? 8;
const maxTurns = numOrNull(argValue("--max-turns")) ?? undefined;
const temperature = numOrNull(argValue("--temperature")) ?? 0;

/* ─── Main ──────────────────────────────────────────────────────── */

function main(): void {
  const artifact = readPolicyArtifactFile(artifactPath);
  if (!artifact) {
    console.error(
      `[duel] no valid policy artifact at ${artifactPath} — ` +
        `check the path, policy_schema_version, and feature names`,
    );
    process.exitCode = 1;
    return;
  }

  const decks = (metaDecksRaw as unknown as (MetaDeckEntry & {
    variants?: { cards: MetaDeckEntry["cards"] }[];
  })[])
    .slice(0, deckCount)
    .map((d) => ({
      id: d.id,
      list: metaDeckToList({ ...d, cards: d.cards?.length ? d.cards : d.variants?.[0]?.cards ?? [] }),
    }))
    .filter((d) => d.list.length > 0);
  if (decks.length === 0) throw new Error("duel: no usable meta decks");

  const evaluator = createBotEvaluator();
  console.log(
    `[duel] ${artifact.model_version} (ranker${temperature > 0 ? ` τ=${temperature}` : ""}) ` +
      `vs planner skill=${skill.toFixed(2)} — games=${games} seed=${seed} ` +
      `decks=${decks.length} evaluator=${evaluator ? "winprob" : "heuristic"}`,
  );

  const startedAt = Date.now();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalTurns = 0;
  const endReasons: Record<string, number> = {};

  for (let g = 0; g < games; g++) {
    const gameSeed = hashSeed(`duel:${seed}:${g}`);
    // Alternate the ranker's side every game and the first actor every two
    // games — all four (side, first) combos each 4-game block.
    const rankerSide: "player" | "opponent" = g % 2 === 0 ? "player" : "opponent";
    const firstActor: "player" | "opponent" = Math.floor(g / 2) % 2 === 0 ? "player" : "opponent";
    const d = decks.length;
    const deckA = decks[g % d];
    const deckB = decks[d > 1 ? (g % d + 1 + (g % (d - 1))) % d : 0];

    const ranker = new RankerPolicy(artifact, {
      seed: (gameSeed ^ 0x9e3779b9) >>> 0,
      ...(temperature > 0 ? { temperature } : {}),
    });
    const planner = new PlannerPolicy({
      params: plannerParamsForSkill(skill),
      seed: (gameSeed ^ 0x85ebca6b) >>> 0,
      ...(evaluator ? { evaluate: evaluator } : {}),
    });

    const outcome: GameOutcome = playGame(
      instantiateDeck(deckA.list),
      instantiateDeck(deckB.list),
      {
        player: rankerSide === "player" ? ranker : planner,
        opponent: rankerSide === "opponent" ? ranker : planner,
      },
      mulberry32(gameSeed),
      firstActor,
      maxTurns ? { maxTurns } : {},
    );

    if (outcome.winner === null) draws += 1;
    else if (outcome.winner === rankerSide) wins += 1;
    else losses += 1;
    totalTurns += outcome.turns;
    endReasons[outcome.endReason] = (endReasons[outcome.endReason] ?? 0) + 1;
  }

  // Win rate scores draws as half; 95% CI via normal approximation.
  const p = (wins + 0.5 * draws) / games;
  const halfWidth = 1.96 * Math.sqrt((p * (1 - p)) / games);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const lo = Math.max(0, p - halfWidth);
  const hi = Math.min(1, p + halfWidth);
  const reasons = Object.entries(endReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(
    `[duel] ranker: ${wins}W / ${losses}L / ${draws}D — ` +
      `win rate ${pct(p)} (95% CI ${pct(lo)}–${pct(hi)})`,
  );
  console.log(
    `[duel] avg turns ${(totalTurns / games).toFixed(1)} | end reasons: ${reasons} | ${elapsed}s`,
  );
}

main();
