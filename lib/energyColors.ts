/**
 * Elemental energy type → swatch hex. Single source of truth; re-exported
 * from `app/components/DeckProfileView` so existing import paths keep working
 * (and new modules like DeckEnergyModule can import it without a circular
 * dependency back through DeckProfileView).
 */
export const ENERGY_HEX: Record<string, string> = {
  Fire:      "#d93232",
  Water:     "#0096d3",
  Grass:     "#64bf4b",
  Lightning: "#f2b90c",
  Psychic:   "#9263a6",
  Fighting:  "#c56928",
  Darkness:  "#245B64",
  Metal:     "#7e949a",
  Dragon:    "#1a5276",
  Fairy:     "#fd79a8",
  Colorless: "#b2bec3",
};
