/**
 * Shared design tokens for the /experiments/* design-identity preview.
 *
 * Kept as string constants (not a CSS var) so arbitrary Tailwind values can
 * consume them via inline style / `bg-[...]` arbitrary classes.
 */

/** 2-stop warm gradient used on the headline accent, primary CTAs, and the
 *  glow ring around the deck input. Gold → deep red. */
export const BRAND_GRADIENT =
  "linear-gradient(90deg,#D99B29_0%,#8C2711_100%)";

/** Same gradient expressed without underscores (for inline style consumption). */
export const BRAND_GRADIENT_CSS =
  "linear-gradient(90deg,#D99B29 0%,#8C2711 100%)";

/** Warm, coral-red tinted shadow used under the hero input card and the
 *  final-CTA panel. */
export const WARM_SHADOW = "0 20px 60px -15px rgba(140,39,17,0.25)";

/** Eyebrow accent color (section intros). Matches the project accent. */
export const EYEBROW_COLOR = "#D91E0D";
