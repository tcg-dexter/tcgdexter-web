import { NextRequest, NextResponse } from "next/server";
import shopListingsData from "@/data/shop-listings.json";
import metaArchetypesData from "@/data/meta-archetypes.json";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import {
  type Card,
  parseDeckListCards,
  pickPrinting,
  pickPrintingForCard,
  ROTATING_MARKS,
  hasLegalTrainerReprint,
} from "@/lib/cardPrinting";

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

/* ─── Types ──────────────────────────────────────────────────── */
/* Card DB, the deck-list parser, and printing resolution live in
 * @/lib/cardPrinting so this route and lib/reprice-deck.ts resolve the
 * same printing for legality + price. */

interface PokemonAbility {
  pokemonName: string;
  abilityName: string;
  description: string;
}

interface PokemonAttack {
  pokemonName: string;
  attackName: string;
  cost: string[];
  damage: string;
  description: string;
}

interface AnalysisResult {
  deckSize: number;
  sections: {
    pokemon: number;
    trainer: number;
    energy: number;
    pokemonRatio: string;
    trainerRatio: string;
    energyRatio: string;
  };
  pokemon: {
    totalCards: number;
    uniqueSpecies: number;
    basicCount: number;
    stage1Count: number;
    stage2Count: number;
    abilities: PokemonAbility[];
    attacks: PokemonAttack[];
    /** Map of Pokémon card name → its elemental types (usually a single
     *  entry; some cards are dual-typed). Sourced from card DB, not inferred. */
    typesByName: Record<string, string[]>;
  };
  trainer: {
    totalCards: number;
    uniqueCards: number;
    supporterCount: number;
    itemCount: number;
    toolCount: number;
    stadiumCount: number;
    details: Array<{ name: string; description: string }>;
  };
  energy: {
    totalCards: number;
    basicByType: Record<string, number>;
    basicCount: number;
    specialCount: number;
    specialDetails: Array<{ name: string; qty: number; description: string }>;
  };
  rotation: {
    ready: boolean;
    rotatingCount: number;
    rotatingCards: Array<{ name: string; qty: number }>;
  };
  metaMatch: {
    matched: boolean;
    archetypeName: string | null;
    archetypeId: string | null;
    matchPct: number | null;
    rank: number | null;
    conversionRate: number | null;
  };
  deckPrice: number;
  cards: Card[];
  warnings: string[];
  deckScore: {
    total: number;
    grade: string;
    rotation: number;
    consistency: number;
    evolution: number;
    energyFit: number;
  };
  shopMatches: Array<{
    cardName: string;
    listings: ShopListing[];
  }>;
}

interface MetaArchetype {
  id?: string | number;
  name: string;
  representation_pct: number;
  top_cut_entries?: number;
  conversion_rate?: number;
}

/* ─── Archetype Detection ────────────────────────────────────── */

interface ArchetypeRule {
  required: string[];
  optional?: string[];
  name: string;
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  { required: ["Charizard ex"], optional: ["Pidgeot ex"], name: "Charizard ex" },
  { required: ["Dragapult ex", "Dusknoir"], name: "Dragapult ex / Dusknoir" },
  { required: ["Regidrago VSTAR"], name: "Regidrago VSTAR" },
  { required: ["Gardevoir ex"], optional: ["Drifloon"], name: "Gardevoir ex" },
  { required: ["Lugia VSTAR"], optional: ["Archeops"], name: "Lugia VSTAR / Archeops" },
  { required: ["Snorlax"], optional: ["Rotom V"], name: "Snorlax Stall" },
  { required: ["Raging Bolt ex"], optional: ["Ogerpon ex"], name: "Raging Bolt ex" },
  { required: ["Terapagos ex"], name: "Terapagos ex" },
  { required: ["Miraidon ex"], name: "Miraidon ex" },
  { required: ["Palkia VSTAR"], name: "Palkia VSTAR" },
  { required: ["Chien-Pao ex"], optional: ["Baxcalibur"], name: "Chien-Pao ex / Baxcalibur" },
  { required: ["Marnie's Grimmsnarl ex", "Froslass"], name: "Grimmsnarl ex / Froslass" },
  { required: ["Lost Zone", "Comfey"], name: "Lost Zone Box" },
];

function detectArchetypeName(cards: Card[]): string | null {
  const names = cards.map((c) => c.name.toLowerCase());
  const hasCard = (name: string) => {
    const lower = name.toLowerCase();
    return names.some((n) => n === lower || n.includes(lower));
  };

  const sorted = [...ARCHETYPE_RULES].sort(
    (a, b) => b.required.length - a.required.length
  );

  for (const rule of sorted) {
    if (rule.required.every((r) => hasCard(r))) {
      return rule.name;
    }
  }

  return null;
}

/* ─── Meta Archetypes (static, bundled at build time) ────────── */

const STATIC_META_ARCHETYPES: MetaArchetype[] = metaArchetypesData as MetaArchetype[];

/* ─── Route Handler ──────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const { deckList } = (await req.json()) as { deckList?: string };

    if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
      return NextResponse.json(
        { error: "Deck list is required." },
        { status: 400 }
      );
    }

    const cards = parseDeckListCards(deckList);

    if (cards.length === 0) {
      return NextResponse.json(
        { error: "Could not parse any cards. Check your deck list format." },
        { status: 400 }
      );
    }

    const pokemonCount = cards
      .filter((c) => c.section === "pokemon")
      .reduce((s, c) => s + c.qty, 0);
    const trainerCount = cards
      .filter((c) => c.section === "trainer")
      .reduce((s, c) => s + c.qty, 0);
    const energyCount = cards
      .filter((c) => c.section === "energy")
      .reduce((s, c) => s + c.qty, 0);
    const deckSize = pokemonCount + trainerCount + energyCount;

    const sections = {
      pokemon: pokemonCount,
      trainer: trainerCount,
      energy: energyCount,
      pokemonRatio: deckSize > 0 ? `${Math.round((pokemonCount / deckSize) * 100)}%` : "0%",
      trainerRatio: deckSize > 0 ? `${Math.round((trainerCount / deckSize) * 100)}%` : "0%",
      energyRatio: deckSize > 0 ? `${Math.round((energyCount / deckSize) * 100)}%` : "0%",
    };

    // Warnings — deck size only
    const warnings: string[] = [];
    if (deckSize !== 60) {
      warnings.push(`Deck has ${deckSize} cards — standard format requires exactly 60.`);
    }

    // ── Pokémon Breakdown ──────────────────────────────────────
    const pokemonCards = cards.filter((c) => c.section === "pokemon");
    const uniquePokemonNames = Array.from(new Set(pokemonCards.map((c) => c.name)));
    const totalPokemonCards = pokemonCards.reduce((s, c) => s + c.qty, 0);

    // Use bundled static archetypes (exported from daemon, always available)
    const metaArchetypes: MetaArchetype[] = STATIC_META_ARCHETYPES;

    const abilities: PokemonAbility[] = [];
    const attacks: PokemonAttack[] = [];
    const typesByName: Record<string, string[]> = {};
    let basicCount = 0;
    let stage1Count = 0;
    let stage2Count = 0;

    for (const pokemonName of uniquePokemonNames) {
      const deckCard = pokemonCards.find((c) => c.name === pokemonName);
      const card = deckCard
        ? pickPrintingForCard(deckCard)
        : pickPrinting(pokemonName);
      const qty = deckCard?.qty ?? 1;
      if (card) {
        const subtypes: string[] = card.subtypes ?? [];
        if (subtypes.includes("Stage 2")) stage2Count += qty;
        else if (subtypes.includes("Stage 1")) stage1Count += qty;
        else if (subtypes.includes("Basic")) basicCount += qty;
        if (card.types && card.types.length > 0) {
          typesByName[pokemonName] = card.types;
        }
      }
      if (!card) continue;

      for (const ab of card.abilities) {
        if (ab.name) {
          abilities.push({
            pokemonName,
            abilityName: ab.name,
            description: ab.text ?? "",
          });
        }
      }

      for (const atk of card.attacks) {
        if (atk.name) {
          attacks.push({
            pokemonName,
            attackName: atk.name,
            cost: atk.cost ?? [],
            damage: atk.damage ?? "",
            description: atk.text ?? "",
          });
        }
      }
    }

    // ── Meta Match ─────────────────────────────────────────────
    let metaMatch: AnalysisResult["metaMatch"] = {
      matched: false,
      archetypeName: null,
      archetypeId: null,
      matchPct: null,
      rank: null,
      conversionRate: null,
    };

    const pokemonNames = cards
      .filter((c) => c.section === "pokemon")
      .map((c) => c.name.toLowerCase()
        .replace(/\s+(ex|vstar|vmax|v|gx)$/i, "")
        .replace(/^mega\s+/i, "")
        .trim()
      );

    if (metaArchetypes.length > 0) {
      // Score every archetype — pick the best match above threshold
      let bestScore = 0;
      let bestIndex = -1;
      let bestEntry: MetaArchetype | null = null;

      metaArchetypes.forEach((m, i) => {
        const archWords = m.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (archWords.length === 0) return;
        const matchedWords = archWords.filter(word =>
          pokemonNames.some(pName => pName === word || pName.startsWith(word) || word.startsWith(pName))
        );
        const score = matchedWords.length / archWords.length;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
          bestEntry = m;
        }
      });

      // Require at least 50% of archetype name words to match
      if (bestEntry && bestScore >= 0.5) {
        metaMatch = {
          matched: true,
          archetypeName: (bestEntry as MetaArchetype).name,
          archetypeId: String((bestEntry as MetaArchetype).id) ?? null,
          matchPct: bestScore,
          rank: bestIndex + 1,
          conversionRate: (bestEntry as MetaArchetype).conversion_rate ?? null,
        };
      }
    }

    // ── Trainer Breakdown ──────────────────────────────────────
    const trainerCards = cards.filter((c) => c.section === "trainer");
    const uniqueTrainerNames = new Set(trainerCards.map((c) => c.name));
    let supporterCount = 0, itemCount = 0, toolCount = 0, stadiumCount = 0;
    for (const tc of trainerCards) {
      const data = pickPrintingForCard(tc);
      const subtypes: string[] = data?.subtypes ?? [];
      if (subtypes.includes("Supporter")) supporterCount += tc.qty;
      else if (subtypes.includes("Stadium")) stadiumCount += tc.qty;
      else if (subtypes.includes("Pokémon Tool")) toolCount += tc.qty;
      else if (subtypes.includes("Item")) itemCount += tc.qty;
    }

    // ── Trainer Details ────────────────────────────────────────
    const ENERGY_SYMBOL_TO_TYPE: Record<string, string> = {
      R: "Fire", W: "Water", G: "Grass", L: "Lightning",
      P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal",
      Y: "Fairy", N: "Dragon", C: "Colorless",
    };
    const trainerDetails: Array<{ name: string; description: string }> = [];
    const seenTrainers = new Set<string>();
    for (const tc of trainerCards) {
      if (seenTrainers.has(tc.name)) continue;
      seenTrainers.add(tc.name);
      const data = pickPrintingForCard(tc);
      const effect = data?.rules?.[0] ?? data?.attacks?.[0]?.text ?? data?.abilities?.[0]?.text ?? "";
      if (effect) trainerDetails.push({ name: tc.name, description: effect });
    }

    // ── Energy Breakdown ───────────────────────────────────────
    const energyCards = cards.filter((c) => c.section === "energy");
    const basicByType: Record<string, number> = {}; // e.g. { Fire: 6, Water: 4 }
    const specialEnergyDetails: Array<{ name: string; qty: number; description: string }> = [];
    let energySpecialCount = 0;
    for (const ec of energyCards) {
      const data = pickPrintingForCard(ec);
      const subtypes: string[] = data?.subtypes ?? [];
      const isBasic = subtypes.includes("Basic") || ec.name.toLowerCase().includes("basic");
      if (isBasic) {
        // Extract type: "Basic {D} Energy" → D → Darkness, "Basic Fire Energy" → Fire
        const symbolMatch = ec.name.match(/\{(\w)\}/);
        const wordMatch = ec.name.match(/Basic (\w+) Energy/i);
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

    // ── Deck Price ─────────────────────────────────────────────
    // pickPrintingForCard already handles set-code → number → first-printing fallback.
    const deckPrice = cards.reduce((sum, card) => {
      const printing = pickPrintingForCard(card);
      const price = printing?.market_price ?? 0;
      return sum + price * card.qty;
    }, 0);

    // ── Rotation Check ─────────────────────────────────────────
    const rotatingCards: Array<{ name: string; qty: number }> = [];
    for (const card of cards) {
      const data = pickPrintingForCard(card);
      const mark = data?.regulation_mark ?? null;
      if (
        mark &&
        ROTATING_MARKS.has(mark.toUpperCase()) &&
        !hasLegalTrainerReprint(card.name)
      ) {
        rotatingCards.push({ name: card.name, qty: card.qty });
      }
    }
    const rotatingCount = rotatingCards.reduce((s, c) => s + c.qty, 0);

    // ── Shop Matches ───────────────────────────────────────────
    // Match by name + card number first (exact printing), fall back to name only
    const shopMatches = cards
      .map(card => {
        const nameLower = card.name.toLowerCase();
        const exactKey = card.number ? `${nameLower}:${card.number}` : null;
        const listings = (exactKey && SHOP_LISTINGS[exactKey])
          ? SHOP_LISTINGS[exactKey]
          : (SHOP_LISTINGS[nameLower] ?? []);
        return { cardName: card.name, listings };
      })
      .filter(m => m.listings.length > 0)
      .filter((m, i, arr) => arr.findIndex(x => x.cardName === m.cardName) === i);

    // ── Deck Health Score ──────────────────────────────────────
    const STAPLE_TRAINERS = [
      "professor's research", "iono", "colress's experiment", "arven", "nemona", "penny",
      "ultra ball", "nest ball", "pokégear 3.0", "battle vip pass", "buddy-buddy poffin",
      "crispin", "kieran", "perrin", "lacey",
      "rare candy", "level ball", "quick ball", "energy search",
    ];

    // Rotation score (0–25)
    const uniqueRotating = new Set(rotatingCards.map(c => c.name)).size;
    const rotationScore = Math.max(25 - uniqueRotating * 5, 0);

    // Consistency score (0–25)
    const deckTrainerNames = new Set(
      cards.filter(c => c.section === "trainer").map(c => c.name.toLowerCase())
    );
    let stapleCount = 0;
    for (const staple of STAPLE_TRAINERS) {
      if (deckTrainerNames.has(staple)) stapleCount++;
    }
    const consistencyScore = Math.min(stapleCount * 3, 25);

    // Evolution score (0–25)
    const stage2Names: string[] = [];
    const stage1Names: string[] = [];
    const basicNames: string[] = [];
    for (const pokemonName of uniquePokemonNames) {
      const deckCard = pokemonCards.find((c) => c.name === pokemonName);
      const card = deckCard
        ? pickPrintingForCard(deckCard)
        : pickPrinting(pokemonName);
      const subtypes: string[] = card?.subtypes ?? [];
      if (subtypes.includes("Stage 2")) stage2Names.push(pokemonName);
      else if (subtypes.includes("Stage 1")) stage1Names.push(pokemonName);
      else if (subtypes.includes("Basic")) basicNames.push(pokemonName);
    }

    const sharesWord = (a: string, b: string): boolean => {
      const wordsA = a.toLowerCase().split(/\s+/);
      const wordsB = new Set(b.toLowerCase().split(/\s+/));
      return wordsA.some(w => w.length > 2 && wordsB.has(w));
    };

    let evolutionScore = 25;
    for (const s2 of stage2Names) {
      if (!stage1Names.some(s1 => sharesWord(s2, s1))) evolutionScore -= 8;
    }
    for (const s1 of stage1Names) {
      if (!basicNames.some(b => sharesWord(s1, b))) evolutionScore -= 5;
    }
    evolutionScore = Math.max(evolutionScore, 0);

    // Energy fit score (0–25)
    let energyScore: number;
    if (energyCount >= 8 && energyCount <= 14) energyScore = 25;
    else if ((energyCount >= 6 && energyCount <= 7) || (energyCount >= 15 && energyCount <= 16)) energyScore = 15;
    else if ((energyCount >= 4 && energyCount <= 5) || (energyCount >= 17 && energyCount <= 18)) energyScore = 8;
    else energyScore = 0;

    // Grade
    const totalScore = rotationScore + consistencyScore + evolutionScore + energyScore;
    let grade: string;
    if (totalScore >= 90) grade = "S";
    else if (totalScore >= 80) grade = "A";
    else if (totalScore >= 70) grade = "B";
    else if (totalScore >= 55) grade = "C";
    else grade = "D";

    const deckScore = {
      total: totalScore,
      grade,
      rotation: rotationScore,
      consistency: consistencyScore,
      evolution: evolutionScore,
      energyFit: energyScore,
    };

    const result: AnalysisResult = {
      deckSize,
      sections,
      pokemon: {
        totalCards: totalPokemonCards,
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
      cards,
      warnings,
      shopMatches,
    };

    // ── Capture submission (fire-and-forget, never blocks response) ──
    // Phase 2: writes to Postgres instead of public Vercel Blob.
    // Uses the admin client (service role) because analysis_submissions
    // has no user-level RLS and anonymous users need to be able to submit.
    const locale = req.headers.get("accept-language")?.split(",")[0] ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // Attach user_id if signed in (non-blocking — if this fails, still capture anonymously)
    let userId: string | null = null;
    try {
      const userClient = await createClient();
      const {
        data: { user },
      } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // Swallow — capture still happens anonymously.
    }

    try {
      const admin = createAdminClient();
      admin
        .from("analysis_submissions")
        .insert({
          user_id: userId,
          deck_list: deckList,
          analysis_summary: {
            deckSize: result.deckSize,
            sections: result.sections,
            rotation: result.rotation,
            metaMatch: result.metaMatch,
            deckScore: result.deckScore,
            warnings: result.warnings,
          },
          locale,
          user_agent: userAgent,
        })
        .then(({ error }) => {
          if (error) {
            console.error("[analyze] submission capture failed:", error);
          }
        });
    } catch (err) {
      // Swallow — never fail a user request over logging.
      console.error("[analyze] admin client init failed:", err);
    }

    // Behavioral event — joined into funnels/adoption views. The legacy
    // analysis_submissions insert above stays for its richer payload; this
    // mirrors the same fact in the unified events table.
    void track(req, "analyze.completed", {
      deck_size: result.deckSize,
      archetype: result.metaMatch?.archetypeName ?? null,
      anonymous: userId === null,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to analyze deck list." },
      { status: 500 }
    );
  }
}
