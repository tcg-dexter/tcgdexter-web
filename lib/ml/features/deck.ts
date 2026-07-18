// Deck-list → model-ready deck features. Thin, lossy-on-purpose numeric
// projection of analyzeDeckList's AnalysisResult — the analyzer stays the
// single source of truth for deck semantics (legality, archetype, score).
//
// Pure and synchronous, no Next runtime. Throws DeckParseError (from
// analyzeDeckList) on unparseable lists; callers decide skip-vs-fail.

import { analyzeDeckList, detectDeckArchetype } from "@/lib/analyzeDeck";
import { bool01, num, numOrNull } from "./guards";
import type { DeckFeatures } from "./types";

export function extractDeckFeatures(deckList: string): DeckFeatures {
  const analysis = analyzeDeckList(deckList);
  const archetype = detectDeckArchetype(analysis);

  const uniqueTrainers = num(analysis.trainer.uniqueCards);
  const deckSize = num(analysis.deckSize);
  const ratio = (count: number) => (deckSize > 0 ? count / deckSize : 0);

  return {
    deck_size: deckSize,
    pokemon_count: num(analysis.sections.pokemon),
    trainer_count: num(analysis.sections.trainer),
    energy_count: num(analysis.sections.energy),
    pokemon_ratio: ratio(num(analysis.sections.pokemon)),
    trainer_ratio: ratio(num(analysis.sections.trainer)),
    energy_ratio: ratio(num(analysis.sections.energy)),
    unique_species: num(analysis.pokemon.uniqueSpecies),
    basic_count: num(analysis.pokemon.basicCount),
    stage1_count: num(analysis.pokemon.stage1Count),
    stage2_count: num(analysis.pokemon.stage2Count),
    ability_count: num(analysis.pokemon.abilities.length),
    attack_count: num(analysis.pokemon.attacks.length),
    supporter_count: num(analysis.trainer.supporterCount),
    item_count: num(analysis.trainer.itemCount),
    tool_count: num(analysis.trainer.toolCount),
    stadium_count: num(analysis.trainer.stadiumCount),
    unique_trainers: uniqueTrainers,
    basic_energy_count: num(analysis.energy.basicCount),
    special_energy_count: num(analysis.energy.specialCount),
    energy_type_count: Object.keys(analysis.energy.basicByType).length,
    rotation_ready: bool01(analysis.rotation.ready),
    rotating_count: num(analysis.rotation.rotatingCount),
    meta_matched: bool01(analysis.metaMatch.matched),
    archetype_id: archetype.archetypeId,
    archetype_name: archetype.archetypeName,
    meta_match_pct: numOrNull(analysis.metaMatch.matchPct),
    meta_rank: numOrNull(analysis.metaMatch.rank),
    meta_conversion_rate: numOrNull(analysis.metaMatch.conversionRate),
    score_total: numOrNull(analysis.deckScore?.total),
    score_rotation: numOrNull(analysis.deckScore?.rotation),
    score_consistency: numOrNull(analysis.deckScore?.consistency),
    score_evolution: numOrNull(analysis.deckScore?.evolution),
    score_energy_fit: numOrNull(analysis.deckScore?.energyFit),
    deck_price: num(analysis.deckPrice),
  };
}
