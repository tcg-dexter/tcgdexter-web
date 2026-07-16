// Rebuild deck-list text from a meta deck's structured card list, in the
// sectioned format parseDeckListCards expects. Shared by the AI-player deck
// pickers and the self-play dataset generator.

export interface MetaDeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy" | string;
}

export interface MetaDeckEntry {
  id: string;
  name: string;
  cards: MetaDeckCard[];
}

export function metaDeckToList(deck: MetaDeckEntry): string {
  const sections: Record<string, MetaDeckCard[]> = { pokemon: [], trainer: [], energy: [] };
  for (const card of deck.cards) {
    (sections[card.category] ?? sections.trainer).push(card);
  }
  const lines: string[] = [];
  const titles: Record<string, string> = { pokemon: "Pokémon", trainer: "Trainer", energy: "Energy" };
  for (const key of ["pokemon", "trainer", "energy"]) {
    const cards = sections[key];
    if (cards.length === 0) continue;
    lines.push(`${titles[key]}: ${cards.reduce((s, c) => s + c.qty, 0)}`);
    for (const c of cards) lines.push(`${c.qty} ${c.name} ${c.setCode} ${c.number}`);
  }
  return lines.join("\n");
}
