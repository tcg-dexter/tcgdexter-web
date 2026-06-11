/** Shared types for Social Studio templates. Each template renders at a
 *  fixed 1080×1920 canvas (9:16) so a single browser screenshot at 100%
 *  zoom captures the exact asset. */

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export interface SpotlightSubject {
  kind: "spotlight";
  id: string;
  slug: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  /** Color stops used for the banner gradient — favorite Pokémon →
   *  first-collection card → first-play card. Resolved server-side. */
  accentColors: string[];
  pokemonName: string | null;
}

export interface MetaArchetypeSubject {
  kind: "meta_archetype";
  id: string;
  name: string;
  representationPct: number;
  iconUrl: string | null;
  imageUrl: string | null;
  accentColor: string;
}

export interface FeaturedDeckSubject {
  kind: "featured_deck";
  id: string;
  name: string;
  username: string;
  displayName: string;
  coverImageUrl: string | null;
  iconUrl: string | null;
  accentColor: string;
  likeCount: number;
  price: number | null;
}

export interface FeaturedMatchSubject {
  kind: "featured_match";
  id: string;
  /** TCG Dexter handles retained for the subject dropdown label; the
   *  template itself renders the TCG Live handles below. */
  username: string;
  displayName: string;
  deckName: string;
  /** Player's deck cover (the player-side hero card on the banner). */
  deckCoverUrl: string | null;
  /** Opponent's top-attacker card image (mirrors /battles resolution). */
  opponentImageUrl: string | null;
  /** Type-color accents per side, used to paint the split gradient. */
  playerAccentColor: string;
  opponentAccentColor: string;
  /** TCG Live in-game handles, pulled from matches.player_handle /
   *  opponent_handle. Fall back to placeholders when missing. */
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "tie";
  playerPrizes: number;
  opponentPrizes: number;
}

export type TemplateSubject =
  | SpotlightSubject
  | MetaArchetypeSubject
  | FeaturedDeckSubject
  | FeaturedMatchSubject;

export type TemplateKind = TemplateSubject["kind"];

export interface TemplateCopy {
  eyebrow: string;
  headline: string;
  subhead: string;
  cta: string;
}

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  spotlight: "Trainer Spotlight",
  meta_archetype: "Meta Archetype",
  featured_deck: "Featured Deck",
  featured_match: "Featured Match",
};
