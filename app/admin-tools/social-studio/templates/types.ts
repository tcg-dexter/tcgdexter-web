import type { ReactNode } from "react";

/** Shared types for Social Studio templates. Each template renders at a
 *  fixed 1080×1920 canvas (9:16) and is composed of named layers so the
 *  editor can toggle, isolate, and export each one as its own PNG. */

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** One compositing layer of a template. `node` is absolutely positioned
 *  content for the 1080×1920 canvas; LayerCanvas stacks layers in array
 *  order (first = bottom). */
export interface StudioLayer {
  /** Stable per-template id, doubles as the export filename suffix. */
  id: string;
  /** Human label shown in the editor's layers panel. */
  name: string;
  /** When set, this layer renders the given copy field — the editor uses
   *  it to show "editable text" affordances in the layers panel. */
  copyField?: keyof TemplateCopy;
  node: ReactNode;
}

/** Route external image URLs through the admin-only proxy so html-to-image
 *  can fetch them same-origin during PNG export (the upstream CDNs don't
 *  all send CORS headers). Relative URLs pass through untouched. */
export function proxied(url: string): string;
export function proxied(url: string | null): string | null;
export function proxied(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  return `/api/admin/social-studio/proxy-image?url=${encodeURIComponent(url)}`;
}

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
  totalEntries: number;
  iconUrl: string | null;
  imageUrl: string | null;
  accentColor: string;
}

export interface CardSpotlightSubject {
  kind: "card_spotlight";
  id: string;
  name: string;
  setName: string;
  number: string;
  rarity: string | null;
  artist: string | null;
  types: string[];
  marketPrice: number | null;
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
  | CardSpotlightSubject
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
  meta_archetype: "Meta Archetype Spotlight",
  card_spotlight: "Card Spotlight",
  featured_deck: "Featured Deck",
  featured_match: "Featured Match",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  spotlight: "Published trainer spotlights — avatar, headline, and partner Pokémon.",
  meta_archetype: "Top archetypes from the live meta, with their share as the hero stat.",
  card_spotlight: "Chase cards from the Standard catalog, ranked by market price.",
  featured_deck: "Most-liked public decks from the community library.",
  featured_match: "Verified TCG Live battles with the head-to-head card stack.",
};
