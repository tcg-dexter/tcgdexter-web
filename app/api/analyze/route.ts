import { NextRequest, NextResponse } from "next/server";

/* ─── Types ──────────────────────────────────────────────────── */

interface Card {
  qty: number;
  name: string;
  section: "pokemon" | "trainer" | "energy";
}

interface EnergyProfile {
  primaryType: string | null;
  types: Record<string, number>;
  specialEnergy: string[];
  totalBasic: number;
  totalSpecial: number;
}

interface MatchupEntry {
  opponent: string;
  result: "Favorable" | "Even" | "Unfavorable";
  note: string;
}

interface Archetype {
  name: string;
  strategy: string;
  tier: number;
  style: "Aggro" | "Control" | "Combo" | "Stall" | "Midrange";
  winCondition: string;
  matchups: MatchupEntry[];
}

interface ConsistencyMetrics {
  drawSupporters: { name: string; qty: number }[];
  searchCards: { name: string; qty: number }[];
  totalDraw: number;
  totalSearch: number;
  rating: string;
}

interface AnalysisResult {
  deckSize: number;
  sections: { pokemon: number; trainer: number; energy: number };
  cards: Card[];
  energyProfile: EnergyProfile;
  archetype: Archetype | null;
  consistency: ConsistencyMetrics;
  warnings: string[];
}

/* ─── Parser ─────────────────────────────────────────────────── */

function parseDeckList(raw: string): Card[] {
  const lines = raw.split("\n").map((l) => l.trim());
  const cards: Card[] = [];
  let currentSection: Card["section"] | null = null;

  for (const line of lines) {
    // Skip blank lines
    if (!line) continue;

    // Detect section headers
    const headerMatch = line.match(/^(Pok[eé]mon|Trainer|Energy)\s*:/i);
    if (headerMatch) {
      const h = headerMatch[1].toLowerCase();
      if (h.startsWith("pok")) currentSection = "pokemon";
      else if (h === "trainer") currentSection = "trainer";
      else currentSection = "energy";
      continue;
    }

    // Skip "Total Cards" line
    if (/^total\s+cards?\s*:/i.test(line)) continue;

    // Parse card line: {qty} {name} {set} {number}
    // Qty is the first token, set is the second-to-last, number is the last
    const cardMatch = line.match(/^(\d+)\s+(.+?)\s+[A-Z0-9-]{2,10}\s+\d+$/);
    if (cardMatch && currentSection) {
      cards.push({
        qty: parseInt(cardMatch[1], 10),
        name: cardMatch[2],
        section: currentSection,
      });
      continue;
    }

    // Fallback: try simpler format {qty} {name} (no set/number)
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

/* ─── Energy Profile ─────────────────────────────────────────── */

const BASIC_ENERGY_MAP: Record<string, string> = {
  fire: "Fire",
  water: "Water",
  grass: "Grass",
  lightning: "Lightning",
  psychic: "Psychic",
  fighting: "Fighting",
  darkness: "Darkness",
  dark: "Darkness",
  metal: "Metal",
  fairy: "Fairy",
  dragon: "Dragon",
  colorless: "Colorless",
};

// PTCGL symbol codes → type name (e.g. "Basic {D} Energy" → Darkness)
const ENERGY_SYMBOL_MAP: Record<string, string> = {
  "{R}": "Fire",
  "{W}": "Water",
  "{G}": "Grass",
  "{L}": "Lightning",
  "{P}": "Psychic",
  "{F}": "Fighting",
  "{D}": "Darkness",
  "{M}": "Metal",
  "{Y}": "Fairy",
  "{N}": "Dragon",
  "{C}": "Colorless",
};

const SPECIAL_ENERGY_NAMES = [
  "Double Turbo Energy",
  "Jet Energy",
  "Luminous Energy",
  "Reversal Energy",
  "Therapeutic Energy",
  "Gift Energy",
  "Neo Upper Energy",
  "Legacy Energy",
  "Mist Energy",
  "V Guard Energy",
  "Regenerative Energy",
  "Super Rod Energy",
];

function analyzeEnergy(cards: Card[]): EnergyProfile {
  const energyCards = cards.filter((c) => c.section === "energy");
  const types: Record<string, number> = {};
  const specialEnergy: string[] = [];
  let totalBasic = 0;
  let totalSpecial = 0;

  for (const card of energyCards) {
    // Check if special energy
    const isSpecial = SPECIAL_ENERGY_NAMES.some((se) =>
      card.name.toLowerCase().includes(se.toLowerCase())
    );

    if (isSpecial) {
      specialEnergy.push(card.name);
      totalSpecial += card.qty;
      continue;
    }

    // Match basic energy — first try PTCGL symbol codes ({D}, {R}, etc.)
    const nameLower = card.name.toLowerCase();
    let matched = false;

    for (const [symbol, typeName] of Object.entries(ENERGY_SYMBOL_MAP)) {
      if (card.name.includes(symbol)) {
        types[typeName] = (types[typeName] || 0) + card.qty;
        totalBasic += card.qty;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Fall back to keyword matching ("Basic Fire Energy", "Darkness Energy", etc.)
      for (const [keyword, typeName] of Object.entries(BASIC_ENERGY_MAP)) {
        if (nameLower.includes(keyword)) {
          types[typeName] = (types[typeName] || 0) + card.qty;
          totalBasic += card.qty;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Unknown energy — still count it
      types[card.name] = (types[card.name] || 0) + card.qty;
      totalBasic += card.qty;
    }
  }

  // Find primary type
  let primaryType: string | null = null;
  let maxCount = 0;
  for (const [type, count] of Object.entries(types)) {
    if (count > maxCount) {
      maxCount = count;
      primaryType = type;
    }
  }

  return { primaryType, types, specialEnergy, totalBasic, totalSpecial };
}

/* ─── Archetype Detection ────────────────────────────────────── */

interface ArchetypeRule {
  required: string[];
  optional?: string[];
  result: Archetype;
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  {
    required: ["Charizard ex"],
    optional: ["Pidgeot ex"],
    result: {
      name: "Charizard ex",
      strategy:
        "Discard-and-accelerate fire aggro. Dominated the meta for two years — fast, explosive, high damage ceiling.",
      tier: 1,
      style: "Aggro",
      winCondition:
        "Accelerate Fire energy from the discard with Burning Darkness, hit for 330+ by late game.",
      matchups: [
        { opponent: "Dragapult ex / Dusknoir", result: "Unfavorable", note: "Phantom Dive pressure and spread counter your slow setup" },
        { opponent: "Gardevoir ex", result: "Even", note: "Similar speed; prize trade comes down to execution" },
        { opponent: "Miraidon ex", result: "Favorable", note: "Charizard bulk absorbs early hits; Burning Darkness OHKOs their basics" },
        { opponent: "Raging Bolt ex", result: "Even", note: "Both hit hard; first to set up wins" },
        { opponent: "Chien-Pao ex / Baxcalibur", result: "Unfavorable", note: "Water weakness; Hail Blade hits for weakness" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Outrace their setup; single-prize pressure disrupts them" },
      ],
    },
  },
  {
    required: ["Dragapult ex", "Dusknoir"],
    result: {
      name: "Dragapult ex / Dusknoir",
      strategy:
        "Spread damage counters with Dusknoir, close out with Dragapult's high burst. Control-aggro hybrid.",
      tier: 1,
      style: "Midrange",
      winCondition:
        "Distribute damage counters with Dusknoir's Ominous Boards, then finish with Phantom Dive.",
      matchups: [
        { opponent: "Charizard ex", result: "Favorable", note: "Spread damage bypasses their healing and punishes multi-prize reliance" },
        { opponent: "Gardevoir ex", result: "Favorable", note: "Phantom Dive spreads into their bench; hard to recover" },
        { opponent: "Miraidon ex", result: "Favorable", note: "Spread damage hits their wide bench efficiently" },
        { opponent: "Raging Bolt ex", result: "Even", note: "Both are fast; depends on who draws disruption first" },
        { opponent: "Chien-Pao ex / Baxcalibur", result: "Even", note: "Spread vs burst; roughly even prize trade" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Dusknoir disrupts their setup before they can copy attacks" },
      ],
    },
  },
  {
    required: ["Regidrago VSTAR"],
    result: {
      name: "Regidrago VSTAR",
      strategy:
        "Copy attacks from Dragon Pokémon in the discard. Extremely flexible — adapts to any matchup with the right discard setup.",
      tier: 1,
      style: "Combo",
      winCondition:
        "Fill the discard with Dragon attackers, copy their attacks with Star Reading VSTAR Power.",
      matchups: [],
    },
  },
  {
    required: ["Gardevoir ex"],
    optional: ["Drifloon"],
    result: {
      name: "Gardevoir ex",
      strategy:
        "Psychic energy acceleration from the discard pile. Strong draw engine with Kirlia's Refinement. Scales damage in the late game.",
      tier: 1,
      style: "Midrange",
      winCondition:
        "Accelerate Psychic energy from the discard with Psychic Embrace, scale Miracle Force damage over time.",
      matchups: [
        { opponent: "Charizard ex", result: "Even", note: "Mirror-ish speed; Charizard weakness to water not relevant" },
        { opponent: "Dragapult ex / Dusknoir", result: "Unfavorable", note: "Spread damage outpaces Gardevoir's scaling" },
        { opponent: "Miraidon ex", result: "Favorable", note: "Gardevoir's HP and energy scaling outlasts their aggro" },
        { opponent: "Raging Bolt ex", result: "Even", note: "Depends on Iono timing and disruption draws" },
        { opponent: "Chien-Pao ex / Baxcalibur", result: "Unfavorable", note: "High-HP Psychic types get OHKOd by Hail Blade with energy stacking" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Faster setup; take prizes before Regidrago goes online" },
      ],
    },
  },
  {
    required: ["Lugia VSTAR"],
    optional: ["Archeops"],
    result: {
      name: "Lugia VSTAR / Archeops",
      strategy:
        "Summon Archeops from the discard with Lugia's VSTAR Power, then accelerate special energy to power up any attacker. Toolbox-style deck.",
      tier: 2,
      style: "Combo",
      winCondition:
        "Use Summoning Star to pull two Archeops, then power up any attacker with Primal Turbo.",
      matchups: [],
    },
  },
  {
    required: ["Snorlax"],
    optional: ["Rotom V"],
    result: {
      name: "Snorlax Stall",
      strategy:
        "Block the active slot with Snorlax, disrupt the opponent's resources, and win by decking them out. Pure control.",
      tier: 2,
      style: "Stall",
      winCondition:
        "Survive every hit with Snorlax + Rigid Band, deck the opponent out.",
      matchups: [],
    },
  },
  {
    required: ["Raging Bolt ex"],
    optional: ["Ogerpon ex"],
    result: {
      name: "Raging Bolt ex",
      strategy:
        "Stack Lightning energy on Raging Bolt for massive damage. Ogerpon provides energy acceleration. Simple but explosive.",
      tier: 1,
      style: "Aggro",
      winCondition:
        "Stack Lightning energy with Ogerpon's Teal Dance, swing for 200+ with Raging Blast.",
      matchups: [
        { opponent: "Charizard ex", result: "Even", note: "First to set up wins; both are explosive" },
        { opponent: "Dragapult ex / Dusknoir", result: "Even", note: "Raging Bolt can OHKO Dragapult; Dusknoir spread is annoying" },
        { opponent: "Gardevoir ex", result: "Even", note: "Depends on disruption and Iono timing" },
        { opponent: "Miraidon ex", result: "Unfavorable", note: "Slower to set up; Miraidon contests early prizes" },
        { opponent: "Chien-Pao ex / Baxcalibur", result: "Even", note: "Both are energy-stack decks; speed determines winner" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Too fast for Regidrago's combo; takes prizes before setup" },
      ],
    },
  },
  {
    required: ["Terapagos ex"],
    result: {
      name: "Terapagos ex",
      strategy:
        "Flexible Colorless attacker that copies attacks. Pairs with various support Pokémon for a toolbox approach.",
      tier: 2,
      style: "Midrange",
      winCondition:
        "Copy powerful attacks with Tera Shell, adapting to whatever the matchup demands.",
      matchups: [],
    },
  },
  {
    required: ["Miraidon ex"],
    result: {
      name: "Miraidon ex",
      strategy:
        "Fast Lightning aggro — Miraidon fills the bench with Electric-types and accelerates energy. Aims to take quick prizes.",
      tier: 2,
      style: "Aggro",
      winCondition:
        "Fill the bench with Lightning-types via Tandem Unit, overwhelm with Photon Blaster.",
      matchups: [
        { opponent: "Charizard ex", result: "Unfavorable", note: "Fire resistance on some attackers; Charizard OHKO potential" },
        { opponent: "Dragapult ex / Dusknoir", result: "Unfavorable", note: "Wide bench is a liability against spread" },
        { opponent: "Gardevoir ex", result: "Unfavorable", note: "Gardevoir scales past Miraidon's damage ceiling" },
        { opponent: "Raging Bolt ex", result: "Favorable", note: "Faster bench setup and consistent damage output" },
        { opponent: "Chien-Pao ex / Baxcalibur", result: "Even", note: "Both are fast aggro; coin flip matchup" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Overwhelm before Regidrago copies anything threatening" },
      ],
    },
  },
  {
    required: ["Palkia VSTAR"],
    result: {
      name: "Palkia VSTAR",
      strategy:
        "Water-based tempo deck that scales damage with bench size. Star Portal VSTAR Power provides mid-game energy recovery.",
      tier: 2,
      style: "Midrange",
      winCondition:
        "Scale Subspace Swell damage with bench size, recover with Star Portal mid-game.",
      matchups: [],
    },
  },
  {
    required: ["Chien-Pao ex"],
    optional: ["Baxcalibur"],
    result: {
      name: "Chien-Pao ex / Baxcalibur",
      strategy:
        "Baxcalibur accelerates Water energy each turn. Chien-Pao hits for huge numbers based on total energy in play.",
      tier: 2,
      style: "Aggro",
      winCondition:
        "Stack Water energy with Wild Cry, hit for massive damage with Hail Blade.",
      matchups: [
        { opponent: "Charizard ex", result: "Favorable", note: "Water weakness; Hail Blade OHKOs Charizard" },
        { opponent: "Dragapult ex / Dusknoir", result: "Even", note: "Chien-Pao can OHKO Dragapult; Dusknoir spread is a problem" },
        { opponent: "Gardevoir ex", result: "Favorable", note: "High damage output pressures Gardevoir before it scales" },
        { opponent: "Miraidon ex", result: "Even", note: "Both are aggro; coin flip matchup" },
        { opponent: "Raging Bolt ex", result: "Even", note: "Energy-stack race; depends on draw" },
        { opponent: "Regidrago VSTAR", result: "Favorable", note: "Too aggressive for Regidrago's slow combo setup" },
      ],
    },
  },
  {
    required: ["Marnie's Grimmsnarl ex", "Froslass"],
    result: {
      name: "Grimmsnarl ex / Froslass",
      strategy:
        "Darkness-type disruption deck. Froslass puts damage counters on the opponent's bench while Marnie's Grimmsnarl ex hits hard with Darkness energy stacked via Munkidori. One of the most disruptive builds in Standard.",
      tier: 1,
      style: "Control",
      winCondition:
        "Stack damage counters with Froslass and Munkidori, then close out with Marnie's Grimmsnarl ex's boosted attacks.",
      matchups: [],
    },
  },
  {
    required: ["Lost Zone", "Comfey"],
    result: {
      name: "Lost Zone Box",
      strategy:
        "Engine built around Comfey's Flower Selecting to fill the Lost Zone, unlocking powerful attacks and abilities from Mirage Gate and friends.",
      tier: 2,
      style: "Combo",
      winCondition:
        "Mill 10 into the Lost Zone via Comfey + Colress's Experiment, unlock Mirage Gate and Cramorant.",
      matchups: [],
    },
  },
];

function inferStyle(cards: Card[]): Archetype["style"] {
  const nameLower = (name: string) => name.toLowerCase();
  const findCard = (search: string) =>
    cards.find((c) => nameLower(c.name).includes(nameLower(search)));

  // Stall signals
  const hasRockyHelmet = findCard("Rocky Helmet");
  const hasSnorlax = findCard("Snorlax");
  const hasKlawf = findCard("Klawf");
  if (hasRockyHelmet || hasSnorlax || hasKlawf) return "Stall";

  // Lost Zone → Combo
  const hasComfey = findCard("Comfey");
  const hasMirageGate = findCard("Mirage Gate");
  if (hasComfey || hasMirageGate) return "Combo";

  // Control signals
  const crushingHammer = findCard("Crushing Hammer");
  const enhancedHammer = findCard("Enhanced Hammer");
  const ionoCard = findCard("Iono");
  const judgeCard = findCard("Judge");
  const controlSignals =
    (crushingHammer ? crushingHammer.qty : 0) +
    (enhancedHammer ? enhancedHammer.qty : 0) +
    (ionoCard && ionoCard.qty >= 3 ? ionoCard.qty : 0) +
    (judgeCard ? judgeCard.qty : 0);
  if (controlSignals >= 4) return "Control";

  // Aggro signals: many basics + energy acceleration
  const pokemonCards = cards.filter((c) => c.section === "pokemon");
  const totalPokemon = pokemonCards.reduce((s, c) => s + c.qty, 0);
  const hasEnergyAccel =
    findCard("Earthen Vessel") ||
    findCard("Double Turbo Energy") ||
    findCard("Jet Energy");
  if (totalPokemon >= 12 && hasEnergyAccel) return "Aggro";

  return "Midrange";
}

function detectArchetype(cards: Card[]): Archetype | null {
  const names = cards.map((c) => c.name.toLowerCase());
  const hasCard = (name: string) => {
    const lower = name.toLowerCase();
    return names.some((n) => n === lower || n.includes(lower));
  };

  // Check rules in order (more specific first — multi-card requirements)
  const sorted = [...ARCHETYPE_RULES].sort(
    (a, b) => b.required.length - a.required.length
  );

  for (const rule of sorted) {
    const allRequired = rule.required.every((r) => hasCard(r));
    if (allRequired) {
      return rule.result;
    }
  }

  return null;
}

function detectArchetypeWithFallback(cards: Card[]): Archetype | null {
  const archetype = detectArchetype(cards);
  if (archetype) return archetype;

  // No known archetype — still infer a style
  const style = inferStyle(cards);
  return {
    name: "Unknown",
    strategy: "No recognized archetype detected. Analysis based on card composition.",
    tier: 3,
    style,
    winCondition: "No specific win condition identified for this archetype.",
    matchups: [],
  };
}

/* ─── Consistency Metrics ────────────────────────────────────── */

const DRAW_SUPPORTERS = [
  "Professor's Research",
  "Professor Turo's Scenario",
  "Professor Sada's Vitality",
  "Iono",
  "Judge",
  "N",
  "Cynthia",
  "Colress",
  "Bibarel",
  "Ciphermaniac's Codebreaking",
];

const SEARCH_CARDS = [
  "Arven",
  "Irida",
  "Nest Ball",
  "Ultra Ball",
  "Level Ball",
  "Quick Ball",
  "Hisuian Heavy Ball",
  "Battle VIP Pass",
  "Pokégear 3.0",
  "Buddy-Buddy Poffin",
  "Earthen Vessel",
  "Pokémon Catcher",
  "Boss's Orders",
  "Computer Search",
  "Luminous Energy",
  "Peonia",
];

function analyzeConsistency(cards: Card[]): ConsistencyMetrics {
  const drawSupporters: { name: string; qty: number }[] = [];
  const searchCards: { name: string; qty: number }[] = [];

  for (const card of cards) {
    const nameLower = card.name.toLowerCase();

    for (const ds of DRAW_SUPPORTERS) {
      if (nameLower.includes(ds.toLowerCase())) {
        drawSupporters.push({ name: card.name, qty: card.qty });
        break;
      }
    }

    for (const sc of SEARCH_CARDS) {
      if (nameLower.includes(sc.toLowerCase())) {
        searchCards.push({ name: card.name, qty: card.qty });
        break;
      }
    }
  }

  const totalDraw = drawSupporters.reduce((sum, d) => sum + d.qty, 0);
  const totalSearch = searchCards.reduce((sum, s) => sum + s.qty, 0);

  let rating: string;
  const combined = totalDraw + totalSearch;
  if (combined >= 16) rating = "Very High";
  else if (combined >= 12) rating = "High";
  else if (combined >= 8) rating = "Moderate";
  else if (combined >= 4) rating = "Low";
  else rating = "Very Low";

  return { drawSupporters, searchCards, totalDraw, totalSearch, rating };
}

/* ─── Warnings ───────────────────────────────────────────────── */

function generateWarnings(
  cards: Card[],
  sections: AnalysisResult["sections"],
  deckSize: number,
  consistency: ConsistencyMetrics
): string[] {
  const warnings: string[] = [];

  if (deckSize !== 60) {
    warnings.push(
      `Deck has ${deckSize} cards — standard format requires exactly 60.`
    );
  }

  if (sections.pokemon === 0) {
    warnings.push("No Pokémon detected. Check your deck list format.");
  }

  if (sections.energy === 0) {
    warnings.push(
      "No energy cards detected. Most decks need energy to attack."
    );
  }

  if (consistency.totalDraw < 4) {
    warnings.push(
      "Very few draw supporters — you may struggle with consistency."
    );
  }

  if (consistency.totalSearch < 4) {
    warnings.push(
      "Low search card count — consider adding more to find key pieces."
    );
  }

  // Check for more than 4 copies of any non-basic-energy card
  const nonEnergy = cards.filter(
    (c) =>
      c.section !== "energy" ||
      !c.name.toLowerCase().includes("basic")
  );
  for (const card of nonEnergy) {
    if (card.qty > 4) {
      warnings.push(
        `${card.name} has ${card.qty} copies — max 4 allowed (except basic energy).`
      );
    }
  }

  return warnings;
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

    const sections = {
      pokemon: cards
        .filter((c) => c.section === "pokemon")
        .reduce((s, c) => s + c.qty, 0),
      trainer: cards
        .filter((c) => c.section === "trainer")
        .reduce((s, c) => s + c.qty, 0),
      energy: cards
        .filter((c) => c.section === "energy")
        .reduce((s, c) => s + c.qty, 0),
    };

    const deckSize = sections.pokemon + sections.trainer + sections.energy;
    const energyProfile = analyzeEnergy(cards);
    const archetype = detectArchetypeWithFallback(cards);
    const consistency = analyzeConsistency(cards);
    const warnings = generateWarnings(cards, sections, deckSize, consistency);

    const result: AnalysisResult = {
      deckSize,
      sections,
      cards,
      energyProfile,
      archetype,
      consistency,
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
