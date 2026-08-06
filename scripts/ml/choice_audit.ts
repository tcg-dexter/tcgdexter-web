/**
 * Which cards make a decision FOR the player?
 *
 * Three bugs in a row were the same shape: a card whose text says "choose" /
 * "discard" / "search" resolved without ever asking. Declarative abilities had
 * no button, Secret Box's discard had no prompt, N's Zoroark's Trade had no
 * prompt. Each was reported as a missing feature; none of them was missing —
 * the engine silently auto-picked.
 *
 * Rather than wait to trip over the rest, this enumerates them. For every
 * card in the meta field it reports the places the engine decides on the
 * player's behalf, ranked by how much of the real field is affected
 * (representation x copies), so the list is a work queue rather than a pile.
 *
 * Two sources of silent choice:
 *
 *   1. `chooser: "auto"` target slots — the effect picks which cards come out
 *      of a hidden zone. Deliberate for the AI (enumerating every combination
 *      explodes the move count) but wrong for a human.
 *   2. Ops that pick with no target slot at all — `discard_hand_cards` is the
 *      one that bit us, and `pickDiscards` is called from four other places
 *      that this cannot see (they are hand-written, not data). Those are
 *      listed at the end for manual review.
 *
 *   npx tsx scripts/ml/choice_audit.ts [--all]
 */

import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { effectsFor, effectDiscardCost } from "@/lib/engine/sim/effects/cards";
import { EFFECT_CARDS } from "@/lib/engine/sim/effects/cards";
import { activatedHandDiscard } from "@/lib/engine/sim/abilities";
import { TRAINER_EFFECTS } from "@/lib/engine/sim/trainers";
import { lookupCard } from "@/lib/engine/catalog";

const SHOW_ALL = process.argv.includes("--all");

interface Arch { id: string; name: string; representation_pct: number }

/** Copies of each card across the field, weighted by archetype share. */
function fieldWeights(): Map<string, number> {
  const archs = new Map((metaArchetypesRaw as Arch[]).map((a) => [a.id, a]));
  const weight = new Map<string, number>();
  for (const raw of metaDecksRaw as (MetaDeckEntry & { id: string; variants?: { cards: unknown[] }[] })[]) {
    const arch = archs.get(raw.id);
    if (!arch) continue;
    const cards = raw.cards?.length ? raw.cards : (raw.variants?.[0]?.cards as MetaDeckEntry["cards"]) ?? [];
    const list = metaDeckToList({ ...raw, cards } as MetaDeckEntry);
    if (!list) continue;
    for (const line of list.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*?)\s*$/);
      if (!m) continue;
      const name = m[2].replace(/\s+[A-Z]{2,4}\s+\d+[a-z]?$/, "");
      weight.set(name, (weight.get(name) ?? 0) + Number(m[1]) * arch.representation_pct);
    }
  }
  return weight;
}

interface Finding {
  card: string;
  weight: number;
  kinds: string[];
}

function main(): void {
  const weights = fieldWeights();
  const findings: Finding[] = [];

  for (const cardName of Object.keys(EFFECT_CARDS)) {
    const kinds: string[] = [];
    effectsFor(cardName).forEach((effect, i) => {
      for (const t of effect.targets ?? []) {
        if (t.chooser === "auto") {
          const zone = t.card?.zone ?? t.mon?.zone ?? "board";
          // Card slots are no longer auto for a human: the picker offers the
          // whole eligible pool from effectCardSlots and validate checks the
          // choice slot-wise. `auto` now means "the AI's single pick".
          const who = t.select === "card" ? "AI-only auto-pick" : "auto-pick";
          kinds.push(`${who} from ${zone} (slot "${t.ref}")`);
        }
      }
      if (effectDiscardCost(cardName, i) > 0) {
        kinds.push(`discard ${effectDiscardCost(cardName, i)} as a cost — PROMPTED`);
      }
    });
    if (kinds.length === 0) continue;
    findings.push({ card: cardName, weight: weights.get(cardName) ?? 0, kinds });
  }

  findings.sort((a, b) => b.weight - a.weight);
  const shown = SHOW_ALL ? findings : findings.filter((f) => f.weight > 0);

  console.log("CARDS THAT DECIDE FOR THE PLAYER\n");
  console.log(`${shown.length} of ${findings.length} affect the current meta field.`);
  console.log("Weight = copies x archetype representation. 0 = not in any meta list.\n");
  console.log("weight   card                            what the engine decides");
  console.log("-".repeat(94));
  for (const f of shown) {
    for (let i = 0; i < f.kinds.length; i++) {
      console.log(
        `${(i === 0 ? f.weight.toFixed(1) : "").padStart(6)}   ` +
          `${(i === 0 ? f.card : "").slice(0, 30).padEnd(32)}${f.kinds[i]}`,
      );
    }
  }

  // The legacy TRAINER_EFFECTS registry is hand-written switch arms, not
  // data, so nothing above can see it. Janine's Secret Art hid there: its
  // text says "Choose up to 2 of your Darkness Pokémon" and the enumerator
  // returned a single move that always picked the Active first. Flag every
  // legacy trainer whose printed text contains a choice verb, so the next
  // one is a line in this report rather than a bug report.
  console.log("\n\nLEGACY TRAINER REGISTRY — printed text implies a choice\n");
  const CHOICE_VERB = /\b(choose|up to|search your deck|discard \d|in any way)/i;
  const legacy: { card: string; weight: number; text: string }[] = [];
  for (const name of Object.keys(TRAINER_EFFECTS)) {
    const text = (lookupCard(name)?.rules ?? []).join(" ");
    if (!CHOICE_VERB.test(text)) continue;
    legacy.push({ card: name, weight: weights.get(name) ?? 0, text });
  }
  legacy.sort((a, b) => b.weight - a.weight);
  console.log("  Verify each ENUMERATES the choice rather than picking for the player.\n");
  for (const l of legacy) {
    console.log(`${l.weight.toFixed(1).padStart(6)}   ${l.card.slice(0, 30).padEnd(32)}${l.text.slice(0, 60)}`);
  }

  console.log("\n\nHAND-WRITTEN AUTO-PICKS (not data — review by hand)\n");
  console.log("  trainers.ts   legacy deck_search discardCost  — PROMPTED (discardCardIds)");
  console.log("  abilities.ts  Trade's discard                 — PROMPTED (handDiscard)");
  console.log("  primitives.ts discard_hand_cards              — PROMPTED (discardCardIds)");
  console.log("  primitives.ts discard_hand_down_to, OUR half  — PROMPTED (discardCardIds)");
  console.log("  primitives.ts discard_hand_down_to, THEIR half— auto BY DESIGN (their choice)");
  console.log("  trainers.ts   Janine target subsets           — ENUMERATED (monIds)");
  console.log("  trainers.ts   Crispin Energy split            — ENUMERATED (expandAuto)");
  console.log("  trainers.ts   Hilda's two fetches             — ENUMERATED (expandAuto)");
  console.log("  stadiums.ts   Academy at Night top-deck       — PROMPTED (handCardIds)");
  console.log("  stadiums.ts   Prism Tower discard 2           — PROMPTED (handCardIds)");
  console.log("  driver.ts     attack rider hand cost          — PROMPTED (riderDiscardCardIds)");
  console.log("  primitives.ts copy-an-attack donor + attack   — ENUMERATED (copyPick, expandAuto)");
  console.log("  placement.ts  bench targets, direct AND copied— PROMPTED (benchDamageTargets/benchCounters)");
  console.log("  runtime.ts    deck-search card slots          — PROMPTED (effectCardSlots manifest)");

  const legacyAbilities = ["N's Zoroark ex::Trade"];
  console.log("\n  legacy abilities declaring a hand cost:");
  for (const key of legacyAbilities) {
    const [c, a] = key.split("::");
    console.log(`    ${key} -> ${activatedHandDiscard(c, a)}`);
  }
  if (!lookupCard("Secret Box")) console.log("\n  (catalog lookup unavailable)");
}

main();
