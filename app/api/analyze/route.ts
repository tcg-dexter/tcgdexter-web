import { NextRequest, NextResponse } from "next/server";
import cardData from "@/data/cards-standard.json";

/* ─── Card DB ────────────────────────────────────────────────── */

interface CardDataEntry {
  name: string;
  set_id: string;
  set_name: string;
  number: string;
  supertype: string;
  subtypes: string[];
  hp: string | null;
  abilities: Array<{ name: string; text: string; type: string }>;
  attacks: Array<{
    name: string;
    cost: string[];
    damage: string;
    text: string;
    convertedEnergyCost: number;
  }>;
  regulation_mark: string | null;
  retreat_cost: number | null;
}

const CARD_DB = cardData as unknown as Record<string, CardDataEntry[]>;
const CARD_DB_LOWER = new Map(
  Object.entries(CARD_DB).map(([k, v]) => [k.toLowerCase(), v])
);

/* ─── Types ──────────────────────────────────────────────────── */

interface Card {
  qty: number;
  name: string;
  section: "pokemon" | "trainer" | "energy";
}

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
  };
  rotation: {
    ready: boolean;
    rotatingCount: number;
    rotatingCards: Array<{ name: string; qty: number }>;
  };
  metaMatch: {
    matched: boolean;
    archetypeName: string | null;
    matchPct: number | null;
  };
  cards: Card[];
  warnings: string[];
}

interface MetaArchetype {
  id?: string | number;
  name: string;
  representation_pct: number;
  top_cut_entries?: number;
}

/* ─── Parser ─────────────────────────────────────────────────── */

function parseDeckList(raw: string): Card[] {
  const lines = raw.split("\n").map((l) => l.trim());
  const cards: Card[] = [];
  let currentSection: Card["section"] | null = null;

  for (const line of lines) {
    if (!line) continue;

    const headerMatch = line.match(/^(Pok[eé]mon|Trainer|Energy)\s*:/i);
    if (headerMatch) {
      const h = headerMatch[1].toLowerCase();
      if (h.startsWith("pok")) currentSection = "pokemon";
      else if (h === "trainer") currentSection = "trainer";
      else currentSection = "energy";
      continue;
    }

    if (/^total\s+cards?\s*:/i.test(line)) continue;

    const cardMatch = line.match(/^(\d+)\s+(.+?)\s+[A-Z0-9-]{2,10}\s+\d+$/);
    if (cardMatch && currentSection) {
      cards.push({
        qty: parseInt(cardMatch[1], 10),
        name: cardMatch[2],
        section: currentSection,
      });
      continue;
    }

    const simpleMatch = line.match(/^(\d+)\s+(.+)$/);
    if (simpleMatch && currentSection) {
      cards.push({
        qty: parseInt(simpleMatch[1], 10),
        name: simpleMatch[2].trim(),
        section: currentSection,
      });
    }
  }

  return cards;
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

/* ─── Static Card Lookup ─────────────────────────────────────── */

function lookupCard(name: string): CardDataEntry | null {
  const entries = CARD_DB_LOWER.get(name.toLowerCase());
  return entries?.[0] ?? null;
}

/* ─── Meta Archetypes (optional, fails gracefully) ───────────── */

async function fetchMetaArchetypes(): Promise<MetaArchetype[]> {
  try {
    const res = await fetch("http://100.80.110.45:8789/v1/meta/archetypes", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list: MetaArchetype[] = Array.isArray(data)
      ? data
      : (data.data ?? data.archetypes ?? data.results ?? []);
    return list
      .sort((a, b) => b.representation_pct - a.representation_pct)
      .slice(0, 20);
  } catch {
    return [];
  }
}

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

    const cards = parseDeckList(deckList);

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

    // Fetch meta archetypes gracefully (may fail if daemon unreachable)
    let metaArchetypes: MetaArchetype[] = [];
    try {
      metaArchetypes = await fetchMetaArchetypes();
    } catch {
      // Daemon unreachable — metaMatch will fall back to { matched: false }
    }

    const abilities: PokemonAbility[] = [];
    const attacks: PokemonAttack[] = [];
    let basicCount = 0;
    let stage1Count = 0;
    let stage2Count = 0;

    for (const pokemonName of uniquePokemonNames) {
      const card = lookupCard(pokemonName);
      const deckCard = pokemonCards.find((c) => c.name === pokemonName);
      const qty = deckCard?.qty ?? 1;
      if (card) {
        const subtypes: string[] = card.subtypes ?? [];
        if (subtypes.includes("Stage 2")) stage2Count += qty;
        else if (subtypes.includes("Stage 1")) stage1Count += qty;
        else if (subtypes.includes("Basic")) basicCount += qty;
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
    const archetypeName = detectArchetypeName(cards);
    let metaMatch: AnalysisResult["metaMatch"] = {
      matched: false,
      archetypeName: null,
      matchPct: null,
    };

    if (archetypeName && metaArchetypes.length > 0) {
      const archLower = archetypeName.toLowerCase();
      const metaEntry = metaArchetypes.find((m) =>
        m.name.toLowerCase().includes(archLower) ||
        archLower.includes(m.name.toLowerCase())
      );
      if (metaEntry) {
        metaMatch = {
          matched: true,
          archetypeName,
          matchPct: metaEntry.representation_pct,
        };
      }
    }

    // ── Rotation Check ─────────────────────────────────────────
    const ROTATING_MARKS = new Set(["A", "B", "C", "D", "E", "F", "G"]);
    const rotatingCards: Array<{ name: string; qty: number }> = [];
    for (const card of cards) {
      const data = CARD_DB_LOWER.get(card.name.toLowerCase())?.[0];
      const mark = data?.regulation_mark ?? null;
      if (mark && ROTATING_MARKS.has(mark.toUpperCase())) {
        rotatingCards.push({ name: card.name, qty: card.qty });
      }
    }
    const rotatingCount = rotatingCards.reduce((s, c) => s + c.qty, 0);

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
      },
      rotation: {
        ready: rotatingCount === 0,
        rotatingCount,
        rotatingCards,
      },
      metaMatch,
      cards,
      warnings,
    };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to analyze deck list." },
      { status: 500 }
    );
  }
}
