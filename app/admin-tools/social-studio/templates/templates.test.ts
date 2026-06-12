import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LayerCanvas from "./LayerCanvas";
import { buildSpotlightLayers } from "./SpotlightTemplate";
import { buildMetaArchetypeLayers } from "./MetaArchetypeTemplate";
import { buildCardSpotlightLayers } from "./CardSpotlightTemplate";
import { buildFeaturedDeckLayers } from "./FeaturedDeckTemplate";
import { buildFeaturedMatchLayers } from "./FeaturedMatchTemplate";
import type {
  CardSpotlightSubject,
  FeaturedDeckSubject,
  FeaturedMatchSubject,
  MetaArchetypeSubject,
  SpotlightSubject,
  StudioLayer,
  TemplateCopy,
} from "./types";

/** Smoke coverage for the Social Studio layer factories: every template
 *  must produce uniquely-id'd layers that render both composited and
 *  standalone (the editor exports each layer as its own PNG). */

const copy: TemplateCopy = {
  eyebrow: "Eyebrow Text",
  headline: "Headline Text",
  subhead: "Subhead Text",
  cta: "CTA Text",
};

const spotlight: SpotlightSubject = {
  kind: "spotlight",
  id: "s1",
  slug: "ash",
  displayName: "Ash Ketchum",
  username: "ash",
  avatarUrl: null,
  headline: "Gotta catch em all",
  accentColors: ["#E1542D", "#3F8FCC"],
  pokemonName: "Pikachu",
};

const metaArchetype: MetaArchetypeSubject = {
  kind: "meta_archetype",
  id: "m1",
  name: "Dragapult ex",
  representationPct: 18.4,
  totalEntries: 1234,
  iconUrl: null,
  imageUrl: "https://images.pokemontcg.io/sv6/130.png",
  accentColor: "#B061BD",
};

const cardSpotlight: CardSpotlightSubject = {
  kind: "card_spotlight",
  id: "base1-4",
  name: "Charizard",
  setName: "Base",
  number: "4",
  rarity: "Rare Holo",
  artist: "Mitsuhiro Arita",
  types: ["Fire"],
  marketPrice: 420.69,
  imageUrl: "https://images.pokemontcg.io/base1/4_hires.png",
  accentColor: "#E1542D",
};

const featuredDeck: FeaturedDeckSubject = {
  kind: "featured_deck",
  id: "d1",
  name: "Turbo Dragapult",
  username: "misty",
  displayName: "Misty",
  coverImageUrl: "https://images.pokemontcg.io/sv6/130.png",
  iconUrl: null,
  accentColor: "#B061BD",
  likeCount: 42,
  price: 150,
};

const featuredMatch: FeaturedMatchSubject = {
  kind: "featured_match",
  id: "fm1",
  username: "brock",
  displayName: "Brock",
  deckName: "Rock Solid",
  deckCoverUrl: "https://images.pokemontcg.io/sv6/110.png",
  opponentImageUrl: "https://images.pokemontcg.io/sv6/130.png",
  playerAccentColor: "#BD5A2A",
  opponentAccentColor: "#B061BD",
  playerHandle: "BrockTCG",
  opponentHandle: "RivalKid",
  opponentArchetype: "Dragapult ex",
  result: "win",
  playerPrizes: 6,
  opponentPrizes: 4,
};

function renderLayers(layers: StudioLayer[]): string {
  return renderToStaticMarkup(createElement(LayerCanvas, { layers }));
}

const cases: Array<{
  label: string;
  layers: StudioLayer[];
  mustContain: string[];
}> = [
  {
    label: "spotlight",
    layers: buildSpotlightLayers(spotlight, copy),
    mustContain: ["Headline Text", "@ash", "Partner Pokémon", "tcgdexter.com/spotlight/ash"],
  },
  {
    label: "meta archetype",
    layers: buildMetaArchetypeLayers(metaArchetype, copy),
    mustContain: ["18.4%", "Meta Share", "1,234 tournament entries tracked"],
  },
  {
    label: "card spotlight",
    layers: buildCardSpotlightLayers(cardSpotlight, copy),
    mustContain: ["$420.69", "Market Price", "Illus. Mitsuhiro Arita"],
  },
  {
    label: "featured deck",
    layers: buildFeaturedDeckLayers(featuredDeck, copy),
    mustContain: ["♥ 42", "@misty", "tcgdexter.com/u/misty/d1"],
  },
  {
    label: "featured match",
    layers: buildFeaturedMatchLayers(featuredMatch, copy),
    mustContain: ["BrockTCG", "RivalKid", "Prizes Taken", "VS", "tcgdexter.com"],
  },
];

describe("social studio layer factories", () => {
  for (const { label, layers, mustContain } of cases) {
    it(`${label}: unique ids, background first, expected content`, () => {
      const ids = layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe("background");
      const html = renderLayers(layers);
      for (const text of mustContain) expect(html).toContain(text);
    });

    it(`${label}: every layer renders standalone`, () => {
      for (const layer of layers) {
        expect(() => renderLayers([layer])).not.toThrow();
      }
    });
  }

  it("external image urls are routed through the admin proxy", () => {
    const html = renderLayers(buildCardSpotlightLayers(cardSpotlight, copy));
    expect(html).toContain("/api/admin/social-studio/proxy-image?url=");
    expect(html).not.toContain('src="https://');
  });
});
