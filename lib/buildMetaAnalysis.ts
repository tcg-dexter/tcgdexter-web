/**
 * buildMetaAnalysis
 *
 * Pure function that produces a full AnalysisResult from a meta-deck card list
 * and archetype metadata. Used by /meta-archetypes/[slug] so the page can render
 * DeckProfileView (with the composition matrix, collapsibles, etc.) without an
 * HTTP round-trip to /api/analyze at static-generation time.
 *
 * Logic mirrors app/api/analyze/route.ts — keep the two in sync if the
 * scoring or card-DB lookup strategy changes.
 */

import cardData from "@/data/cards-standard.json";
import shopListingsData from "@/data/shop-listings.json";
import { type AnalysisResult } from "@/app/components/DeckProfileView";
import { gradeDeck } from "@/lib/deckGrade";
import { buildGradeCards } from "@/lib/deckGrade/buildGradeCards";

/* ─── Card DB ────────────────────────────────────────────────── */

interface CardDataEntry {
  name: string;
  set_id: string;
  number: string;
  supertype: string;
  subtypes: string[];
  types?: string[];
  hp: string | null;
  abilities: Array<{ name: string; text: string; type: string }>;
  attacks: Array<{ name: string; cost: string[]; damage: string; text: string; convertedEnergyCost: number }>;
  rules: string[];
  regulation_mark: string | null;
  market_price: number | null;
}

const CARD_DB = cardData as unknown as Record<string, CardDataEntry[]>;
const CARD_DB_LOWER = new Map(
  Object.entries(CARD_DB).map(([k, v]) => [k.toLowerCase(), v])
);

/* ─── Shop Listings ──────────────────────────────────────────── */

interface ShopListing {
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  listingUrl: string;
  condition: string;
  bestOffer: boolean;
  itemId: string;
}

const SHOP_LISTINGS = shopListingsData as Record<string, ShopListing[]>;

/* ─── Constants ──────────────────────────────────────────────── */

const ROTATING_MARKS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

const ENERGY_SYMBOL_TO_TYPE: Record<string, string> = {
  R: "Fire", W: "Water", G: "Grass", L: "Lightning",
  P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal",
  Y: "Fairy", N: "Dragon", C: "Colorless",
};

const STAPLE_TRAINERS = [
  "professor's research", "iono", "colress's experiment", "arven", "nemona", "penny",
  "ultra ball", "nest ball", "pokégear 3.0", "battle vip pass", "buddy-buddy poffin",
  "crispin", "kieran", "perrin", "lacey",
  "rare candy", "level ball", "quick ball", "energy search",
];

/* ─── Input type ─────────────────────────────────────────────── */

export interface MetaDeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

export interface MetaArchetypeInfo {
  name: string;
  rank: number;
  conversionRate: number;
  representationPct: number;
}

/* ─── Main function ──────────────────────────────────────────── */

export function buildMetaAnalysis(
  metaCards: MetaDeckCard[],
  archetype: MetaArchetypeInfo,
): AnalysisResult {
  // Remap category → section for DeckProfileView compatibility
  const cards = metaCards.map((c) => ({
    qty: c.qty,
    name: c.name,
    number: c.number,
    setCode: c.setCode,
    section: c.category as "pokemon" | "trainer" | "energy",
  }));

  // ── Section counts ────────────────────────────────────────────
  const pokemonCount = cards.filter(c => c.section === "pokemon").reduce((s, c) => s + c.qty, 0);
  const trainerCount = cards.filter(c => c.section === "trainer").reduce((s, c) => s + c.qty, 0);
  const energyCount  = cards.filter(c => c.section === "energy").reduce((s, c) => s + c.qty, 0);
  const deckSize = pokemonCount + trainerCount + energyCount;

  const sections = {
    pokemon: pokemonCount,
    trainer: trainerCount,
    energy: energyCount,
    pokemonRatio: deckSize > 0 ? `${Math.round((pokemonCount / deckSize) * 100)}%` : "0%",
    trainerRatio: deckSize > 0 ? `${Math.round((trainerCount / deckSize) * 100)}%` : "0%",
    energyRatio:  deckSize > 0 ? `${Math.round((energyCount  / deckSize) * 100)}%` : "0%",
  };

  const warnings: string[] = [];
  if (deckSize !== 60) {
    warnings.push(`Deck has ${deckSize} cards — standard format requires exactly 60.`);
  }

  // ── Pokémon breakdown ─────────────────────────────────────────
  const pokemonCards = cards.filter(c => c.section === "pokemon");
  const uniquePokemonNames = Array.from(new Set(pokemonCards.map(c => c.name)));

  const abilities: AnalysisResult["pokemon"]["abilities"] = [];
  const attacks:   AnalysisResult["pokemon"]["attacks"]   = [];
  const typesByName: Record<string, string[]> = {};
  let basicCount = 0, stage1Count = 0, stage2Count = 0;

  for (const pokemonName of uniquePokemonNames) {
    const card = CARD_DB_LOWER.get(pokemonName.toLowerCase())?.[0];
    const deckCard = pokemonCards.find(c => c.name === pokemonName);
    const qty = deckCard?.qty ?? 1;
    if (card) {
      const subtypes = card.subtypes ?? [];
      if (subtypes.includes("Stage 2"))      stage2Count += qty;
      else if (subtypes.includes("Stage 1")) stage1Count += qty;
      else if (subtypes.includes("Basic"))   basicCount  += qty;
      if (card.types && card.types.length > 0) typesByName[pokemonName] = card.types;

      for (const ab of card.abilities) {
        if (ab.name) abilities.push({ pokemonName, abilityName: ab.name, description: ab.text ?? "" });
      }
      for (const atk of card.attacks) {
        if (atk.name) attacks.push({ pokemonName, attackName: atk.name, cost: atk.cost ?? [], damage: atk.damage ?? "", description: atk.text ?? "" });
      }
    }
  }

  // ── Trainer breakdown ─────────────────────────────────────────
  const trainerCards = cards.filter(c => c.section === "trainer");
  const uniqueTrainerNames = new Set(trainerCards.map(c => c.name));
  let supporterCount = 0, itemCount = 0, toolCount = 0, stadiumCount = 0;
  for (const tc of trainerCards) {
    const data = CARD_DB_LOWER.get(tc.name.toLowerCase())?.[0];
    const subtypes = data?.subtypes ?? [];
    if (subtypes.includes("Supporter"))        supporterCount += tc.qty;
    else if (subtypes.includes("Stadium"))     stadiumCount   += tc.qty;
    else if (subtypes.includes("Pokémon Tool")) toolCount     += tc.qty;
    else if (subtypes.includes("Item"))        itemCount      += tc.qty;
  }

  const trainerDetails: Array<{ name: string; description: string }> = [];
  const seenTrainers = new Set<string>();
  for (const tc of trainerCards) {
    if (seenTrainers.has(tc.name)) continue;
    seenTrainers.add(tc.name);
    const data = CARD_DB_LOWER.get(tc.name.toLowerCase())?.[0];
    const effect = data?.rules?.[0] ?? data?.attacks?.[0]?.text ?? data?.abilities?.[0]?.text ?? "";
    if (effect) trainerDetails.push({ name: tc.name, description: effect });
  }

  // ── Energy breakdown ──────────────────────────────────────────
  const energyCards = cards.filter(c => c.section === "energy");
  const basicByType: Record<string, number> = {};
  const specialEnergyDetails: Array<{ name: string; qty: number; description: string }> = [];
  let energySpecialCount = 0;
  for (const ec of energyCards) {
    const data = CARD_DB_LOWER.get(ec.name.toLowerCase())?.[0];
    const subtypes = data?.subtypes ?? [];
    const isBasic = subtypes.includes("Basic") || ec.name.toLowerCase().includes("basic");
    if (isBasic) {
      const symbolMatch = ec.name.match(/\{(\w)\}/);
      const wordMatch   = ec.name.match(/Basic (\w+) Energy/i);
      const typeName = symbolMatch
        ? (ENERGY_SYMBOL_TO_TYPE[symbolMatch[1]] ?? symbolMatch[1])
        : (wordMatch ? wordMatch[1] : "Colorless");
      basicByType[typeName] = (basicByType[typeName] ?? 0) + ec.qty;
    } else {
      energySpecialCount += ec.qty;
      const effect = data?.rules?.[0] ?? data?.attacks?.[0]?.text ?? data?.abilities?.[0]?.text ?? "";
      specialEnergyDetails.push({ name: ec.name, qty: ec.qty, description: effect });
    }
  }
  const energyBasicCount = Object.values(basicByType).reduce((s, n) => s + n, 0);

  // ── Deck price ────────────────────────────────────────────────
  const deckPrice = metaCards.reduce((sum, card) => {
    const printings = CARD_DB_LOWER.get(card.name.toLowerCase()) ?? [];
    let price = 0;
    if (card.number && printings.length > 0) {
      const exact = printings.find(p => p.number === card.number);
      price = exact?.market_price ?? printings[0]?.market_price ?? 0;
    } else {
      price = printings[0]?.market_price ?? 0;
    }
    return sum + price * card.qty;
  }, 0);

  // ── Rotation ──────────────────────────────────────────────────
  const rotatingCards: Array<{ name: string; qty: number }> = [];
  for (const card of cards) {
    const data = CARD_DB_LOWER.get(card.name.toLowerCase())?.[0];
    const mark = data?.regulation_mark ?? null;
    if (mark && ROTATING_MARKS.has(mark.toUpperCase())) {
      rotatingCards.push({ name: card.name, qty: card.qty });
    }
  }
  const rotatingCount = rotatingCards.reduce((s, c) => s + c.qty, 0);

  // ── Shop matches (same exact-key logic as analyze route) ──────
  const shopMatches = cards
    .map(card => {
      const nameLower = card.name.toLowerCase();
      // Meta cards include a card number via setCode+number — use name:number key first
      const metaCard = metaCards.find(mc => mc.name === card.name);
      const exactKey = metaCard?.number ? `${nameLower}:${metaCard.number}` : null;
      const listings = (exactKey && SHOP_LISTINGS[exactKey])
        ? SHOP_LISTINGS[exactKey]
        : (SHOP_LISTINGS[nameLower] ?? []);
      return { cardName: card.name, listings };
    })
    .filter(m => m.listings.length > 0)
    .filter((m, i, arr) => arr.findIndex(x => x.cardName === m.cardName) === i);

  // ── Meta match ────────────────────────────────────────────────
  // For meta deck pages we always know the archetype — populate directly.
  const metaMatch: AnalysisResult["metaMatch"] = {
    matched: true,
    archetypeName: archetype.name,
    matchPct: 1,
    rank: archetype.rank,
    conversionRate: archetype.conversionRate,
  };

  // ── Deck Grade (shared engine — keep in sync with the analyze route) ──
  const deckGrade = gradeDeck({
    cards: buildGradeCards(cards),
    legality: { legal: rotatingCount === 0, rotatingCount },
    meta: {
      archetypeName: metaMatch.archetypeName,
      rank: metaMatch.rank,
      conversionRate: metaMatch.conversionRate,
    },
  });
  const axisPct = (key: string) =>
    deckGrade.axes.find((a) => a.key === key)?.score ?? 0;
  const to25 = (pct: number) => Math.round((pct / 100) * 25);
  const deckScore = {
    total: deckGrade.total,
    grade: deckGrade.grade,
    rotation: Math.max(25 - new Set(rotatingCards.map((c) => c.name)).size * 5, 0),
    consistency: to25(axisPct("setup")),
    evolution: to25(axisPct("evolution")),
    energyFit: to25(axisPct("energy")),
  };

  return {
    deckSize,
    sections,
    pokemon: {
      totalCards: pokemonCount,
      uniqueSpecies: uniquePokemonNames.length,
      basicCount,
      stage1Count,
      stage2Count,
      abilities,
      attacks,
      typesByName,
    },
    trainer: {
      totalCards: trainerCount,
      uniqueCards: uniqueTrainerNames.size,
      supporterCount,
      itemCount,
      toolCount,
      stadiumCount,
      details: trainerDetails,
    },
    energy: {
      totalCards: energyCount,
      basicByType,
      basicCount: energyBasicCount,
      specialCount: energySpecialCount,
      specialDetails: specialEnergyDetails,
    },
    rotation: {
      ready: rotatingCount === 0,
      rotatingCount,
      rotatingCards,
    },
    deckPrice: Math.round(deckPrice * 100) / 100,
    metaMatch,
    deckScore,
    deckGrade,
    cards,
    warnings,
    shopMatches,
  };
}
