// Effect-coverage gap report (W1). For every meta archetype, computes engine
// effect-coverage of its canonical decklist, then ranks the unmodeled cards by
// real meta impact (copies × the archetype's representation_pct, summed across
// archetypes). Turns "implement everything" into a prioritized backlog for
// W2/W3.
//
// Usage: npx tsx scripts/ml/effect_gap_report.ts [--top N]

import metaDecks from "@/data/meta-decks.json";
import metaArchetypes from "@/data/meta-archetypes.json";
import { metaDeckToList } from "@/lib/metaDeckList";
import { deckEffectCoverage } from "@/lib/ml/effectCoverage";
import type { EffectSlotKind } from "@/lib/engine/sim/coverage";

interface Archetype {
  id: string;
  name: string;
  representation_pct: number;
}

function argN(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}

const TOP = argN("--top", 40);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function main(): void {
  const archById = new Map<string, Archetype>(
    (metaArchetypes as Archetype[]).map((a) => [a.id, a]),
  );

  interface AggGap {
    key: string;
    kind: EffectSlotKind;
    weight: number; // Σ copies × representation_pct
    archetypes: Set<string>;
  }
  const agg = new Map<string, AggGap>();
  const perDeck: { name: string; rep: number; fraction: number; slots: number }[] = [];

  for (const deck of metaDecks as { id: string; name: string }[]) {
    const arch = archById.get(deck.id);
    const rep = arch?.representation_pct ?? 0;
    const cov = deckEffectCoverage(metaDeckToList(deck as never));
    perDeck.push({ name: deck.name, rep, fraction: cov.fraction, slots: cov.slots });
    for (const gap of cov.gaps) {
      const a = agg.get(gap.key) ?? {
        key: gap.key,
        kind: gap.kind,
        weight: 0,
        archetypes: new Set<string>(),
      };
      a.weight += gap.copies * rep;
      a.archetypes.add(deck.name);
      agg.set(gap.key, a);
    }
  }

  // Field-weighted effect coverage across the whole meta.
  const fieldWeighted =
    perDeck.reduce((s, d) => s + d.fraction * d.rep, 0) /
    (perDeck.reduce((s, d) => s + d.rep, 0) || 1);

  console.log("=== Per-archetype effect coverage (by field share) ===\n");
  console.log("  coverage  share   slots  archetype");
  for (const d of perDeck.sort((a, b) => b.rep - a.rep)) {
    console.log(
      `  ${pct(d.fraction).padStart(6)}  ${pct(d.rep).padStart(5)}  ${String(d.slots).padStart(5)}  ${d.name}`,
    );
  }
  console.log(`\n  Field-weighted effect coverage: ${pct(fieldWeighted)}`);

  console.log(`\n=== Top ${TOP} unmodeled effects, ranked by meta impact ===\n`);
  console.log("  impact   kind           #decks  effect");
  const ranked = Array.from(agg.values()).sort((a, b) => b.weight - a.weight);
  for (const g of ranked.slice(0, TOP)) {
    console.log(
      `  ${g.weight.toFixed(4)}  ${g.kind.padEnd(14)}  ${String(g.archetypes.size).padStart(5)}   ${g.key}`,
    );
  }
  console.log(`\n  ${ranked.length} distinct unmodeled effects across the field.`);
}

main();
