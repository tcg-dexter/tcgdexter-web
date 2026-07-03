import type { CardRole, GradeCard } from "./types";

/**
 * Hybrid role detection. Trainer *rules* text is noisier than a known-card
 * lookup, so high-signal staples are hand-tagged here, and everything else
 * falls back to pattern-matching the card's combined effect text (which the
 * analyze route now includes Trainer rules text in). Curated entries win.
 *
 * This table is Standard-facing and expected to be topped up as sets release —
 * that maintenance cost is the accepted trade for accuracy on the cards that
 * most define a deck's engine (draw / gust / accel).
 */
const CARD_ROLES: Record<string, CardRole[]> = {
  // Draw supporters
  "professor's research": ["draw"],
  "iono": ["draw", "disruption"],
  "colress's experiment": ["draw"],
  "judge": ["draw", "disruption"],
  "roxanne": ["draw", "disruption"],
  "serena": ["draw"],
  "nemona": ["draw"],
  "hop": ["draw"],
  "pokégear 3.0": ["draw"],
  // Search
  "arven": ["search"],
  "jacq": ["search"],
  "nest ball": ["search"],
  "ultra ball": ["search"],
  "quick ball": ["search"],
  "great ball": ["search"],
  "poké ball": ["search"],
  "level ball": ["search"],
  "buddy-buddy poffin": ["search"],
  "earthen vessel": ["search", "accel"],
  "energy search": ["search"],
  // Gust
  "boss's orders": ["gust"],
  "counter catcher": ["gust"],
  "prime catcher": ["gust", "switch"],
  // Switch (own)
  "switch": ["switch"],
  "switch cart": ["switch"],
  "escape rope": ["switch"],
  "jet energy": ["switch"],
  // Recovery
  "super rod": ["recovery"],
  "night stretcher": ["recovery"],
  "ordinary rod": ["recovery"],
  "energy recycler": ["recovery"],
  "rescue board": ["recovery"],
  "klara": ["recovery"],
  // Disruption / lock
  "lost vacuum": ["disruption"],
  "path to the peak": ["disruption"],
  "temple of sinnoh": ["disruption"],
  "spikemuth gym": ["disruption"],
};

const TEXT_PATTERNS: Array<{ role: CardRole; re: RegExp }> = [
  { role: "draw", re: /draw (a card|\d+ cards?|cards until|until you have)/ },
  { role: "search", re: /search your deck for/ },
  // Boss's-Orders-style gust: pull an opponent's benched Pokémon up.
  { role: "gust", re: /opponent'?s benched pok[eé]mon to the active/ },
  { role: "switch", re: /switch your active pok[eé]mon/ },
  {
    role: "recovery",
    re: /(from your discard pile into your hand|from your discard pile into your deck|shuffle .* from your discard)/,
  },
  { role: "accel", re: /attach .*energy card .* from your (deck|hand)(?!.*as normal)/ },
  {
    role: "disruption",
    re: /(your opponent shuffles their hand|your opponent reveals their hand|discard .* from your opponent)/,
  },
];

/** Roles a single card fills — curated table first, then text fallback. */
export function rolesForCard(card: GradeCard): Set<CardRole> {
  const roles = new Set<CardRole>();

  const curated = CARD_ROLES[card.name.toLowerCase()];
  if (curated) curated.forEach((r) => roles.add(r));

  // Structural: any Stadium is a stadium-role card regardless of text.
  if (card.subtypes.some((s) => s.toLowerCase() === "stadium")) {
    roles.add("stadium");
  }

  // Text fallback fills gaps the curated table didn't cover.
  for (const { role, re } of TEXT_PATTERNS) {
    if (!roles.has(role) && re.test(card.effectText)) roles.add(role);
  }

  return roles;
}

/** Total copies (qty) in the deck that fill a given role. */
export function roleCopies(cards: GradeCard[], role: CardRole): number {
  return cards.reduce(
    (s, c) => (rolesForCard(c).has(role) ? s + c.qty : s),
    0,
  );
}

/** Whether the deck has any card filling a role. */
export function hasRole(cards: GradeCard[], role: CardRole): boolean {
  return cards.some((c) => rolesForCard(c).has(role));
}
