"use client";

import { useState } from "react";
import SectionHeader from "@/app/components/ui/SectionHeader";
import GradientButton from "@/app/components/ui/GradientButton";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import NotificationBell from "@/app/components/ui/NotificationBell";
import StatsStrip from "@/app/components/ui/StatsStrip";
import {
  SkeletonLine,
  SkeletonCircle,
  SkeletonBlock,
  SkeletonCard,
  SkeletonRow,
} from "@/app/components/skeletons/Skeleton";
import SavedDeckRow, {
  RecordPill,
  FormPips,
  CompositionBar,
} from "@/app/my-decks/SavedDeckRow";
import type { UserDeckCardProps } from "@/app/components/DeckPostCard";
import DeckMulliganModule from "@/app/components/DeckMulliganModule";
import DeckPriceModule from "@/app/components/DeckPriceModule";
import DeckOwnershipModule, {
  type OwnableCard,
} from "@/app/components/DeckOwnershipModule";
import StandardFormatInfo from "@/app/components/StandardFormatInfo";
import ShopListingsPanel from "@/app/cards/ShopListingsPanel";
import type { ShopListing } from "@/lib/shopListings";
import FeaturedMatchHero from "@/app/battles/FeaturedMatchHero";
import { MatchCard, type RecentMatch } from "@/app/components/MatchCard";
import MetaVariantCard from "@/app/meta-archetypes/[slug]/MetaVariantCard";
import {
  MAT_STYLES,
  TEXTURES,
  CardPile,
  computeRows,
  ROW_GAP_X,
  MAT_PADDING,
} from "@/app/admin-tools/deck-mat/DeckMatClient";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import BadgeShowcase from "@/app/components/BadgeShowcase";
import SetLogo from "@/app/cards/SetLogo";

/* ── Shared reference-page chrome ─────────────────────────────────────── */

const NAV = [
  {
    heading: "Global",
    items: [
      { id: "colors", label: "Color tokens" },
      { id: "typography", label: "Typography" },
      { id: "buttons", label: "Buttons" },
      { id: "badges", label: "Badges & pills" },
      { id: "cards", label: "Cards & surfaces" },
      { id: "loading", label: "Loading states" },
      { id: "empty", label: "Empty states" },
      { id: "modals", label: "Modals & dialogs" },
      { id: "forms", label: "Form inputs" },
      { id: "toasts", label: "Toasts" },
      { id: "avatars", label: "Avatars" },
      { id: "images", label: "Images & badges" },
    ],
  },
  {
    heading: "By product",
    items: [
      { id: "catalog", label: "Card catalog" },
      { id: "battles", label: "Battles" },
      { id: "meta", label: "Meta archetypes" },
      { id: "deck-profile", label: "Deck profile" },
      { id: "library", label: "Saved deck library" },
      { id: "playmat", label: "Playmat Studio" },
    ],
  },
];

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 mb-16">
      <SectionHeader eyebrow={eyebrow} title={title}>
        {description}
      </SectionHeader>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** Dashed reference frame — separates "this is a demo" from real page chrome. */
function Demo({
  label,
  className = "",
  contentClassName = "",
  children,
}: {
  label?: string;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-black/15 dark:border-white/20 p-5 ${className}`}
    >
      {label && (
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

function CodeNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] text-text-muted leading-relaxed">
      {children}
    </p>
  );
}

/* ── Global: color tokens ─────────────────────────────────────────────── */

const COLOR_TOKENS: { name: string; light: string; dark?: string }[] = [
  { name: "--bg", light: "#f2f2f2", dark: "#242424" },
  { name: "--surface", light: "#e8e8e8", dark: "#303030" },
  { name: "--surface-2", light: "#d8d8d8", dark: "#3c3c3c" },
  { name: "--surface-elevated", light: "#ffffff", dark: "#2e2e2e" },
  { name: "--border", light: "#d4d4d4", dark: "#454545" },
  { name: "--text-primary", light: "#1a1a1a", dark: "#ffffff" },
  { name: "--text-secondary", light: "#4a4a4a", dark: "#b8b8b8" },
  { name: "--text-muted", light: "#888888", dark: "#808080" },
  { name: "--accent", light: "#D91E0D" },
  { name: "--accent-light", light: "#e74c3c" },
  { name: "--accent-dark", light: "#A60D0D" },
];

function ColorSwatch({ name, light, dark }: { name: string; light: string; dark?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded-xl border border-black/10 dark:border-white/10"
        style={{ background: `var(${name})` }}
      />
      <div>
        <div className="font-mono text-xs font-semibold text-text-primary">{name}</div>
        <div className="font-mono text-[11px] text-text-muted">
          {light}
          {dark ? ` (dark: ${dark})` : ""}
        </div>
      </div>
    </div>
  );
}

/* ── Global: mock data used by several product sections below ───────────── */

const MULLIGAN_BASICS = [
  { name: "Dreepy", qty: 4, imageUrl: null },
  { name: "Fezandipiti ex", qty: 3, imageUrl: null },
  { name: "Squawkabilly ex", qty: 2, imageUrl: null },
];

const OWNERSHIP_CARDS: OwnableCard[] = [
  { name: "Dreepy", qty: 4, printings: [] },
  { name: "Drakloak", qty: 2, printings: [] },
  { name: "Dragapult ex", qty: 3, printings: [] },
  { name: "Fezandipiti ex", qty: 2, printings: [] },
  { name: "Squawkabilly ex", qty: 2, printings: [] },
];

const SHOP_LISTINGS: ShopListing[] = [
  {
    title: "Dragapult ex 130/167 — Twilight Masquerade — Near Mint",
    cardNumber: "130",
    price: 24.99,
    currency: "USD",
    imageUrl: null,
    listingUrl: "#",
    condition: "Near Mint",
    bestOffer: false,
    freeShipping: true,
    itemId: "design-library-demo-listing-1",
  },
  {
    title: "Dragapult ex 130/167 — Twilight Masquerade — Lightly Played",
    cardNumber: "130",
    price: 19.5,
    currency: "USD",
    imageUrl: null,
    listingUrl: "#",
    condition: "Lightly Played",
    bestOffer: true,
    freeShipping: false,
    itemId: "design-library-demo-listing-2",
  },
];

const FEATURED_MATCH: RecentMatch = {
  id: "design-library-demo-match",
  shortId: "demo123",
  result: "win",
  opponentArchetype: "Charizard ex",
  opponentHandle: "ashk_champ",
  createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  deckId: "design-library-demo-deck",
  deckName: "Dragapult ex",
  username: "you",
  deckImageUrl: null,
  deckCardNames: [],
  opponentImageUrl: null,
  opponentAttackerName: "Charizard ex",
  playerColor: "#D91E0D",
  opponentColor: "#F2A20C",
  playerPrizes: 6,
  opponentPrizes: 3,
  isBestOf3: true,
  hasBattleLog: true,
  totalDamage: 480,
};

const BATTLE_PREVIEW_CARDS: RecentMatch[] = [
  FEATURED_MATCH,
  {
    ...FEATURED_MATCH,
    id: "design-library-demo-match-loss",
    shortId: "demo124",
    result: "loss",
    playerPrizes: 2,
    opponentPrizes: 6,
    isBestOf3: false,
    totalDamage: null,
  },
  {
    ...FEATURED_MATCH,
    id: "design-library-demo-match-draw",
    shortId: "demo125",
    result: "draw",
    opponentArchetype: "Gardevoir ex",
    opponentAttackerName: "Gardevoir ex",
    playerPrizes: 4,
    opponentPrizes: 4,
    isBestOf3: false,
    totalDamage: null,
  },
];

// Non-UUID ids on purpose — these rows are display-only reference material,
// never meant to round-trip to a real saved_decks row. Any accidental write
// attempt (e.g. fully submitting the inline Log Match form) fails validation
// instead of touching real data.
const SAVED_DECK_ROWS: (UserDeckCardProps & { isLast?: boolean })[] = [
  {
    id: "design-library-demo-row-1",
    name: "Dragapult ex",
    href: "#",
    imageUrl: null,
    username: "you",
    price: 214.87,
    counts: { pokemon: 14, trainer: 32, energy: 14 },
    wl: { w: 12, l: 4, d: 0, recentForm: ["W", "W", "L", "W", "D"] },
    updatedAt: new Date().toISOString(),
  },
  {
    id: "design-library-demo-row-2",
    name: "Gardevoir ex",
    href: "#",
    imageUrl: null,
    username: "you",
    price: 168.4,
    counts: { pokemon: 12, trainer: 34, energy: 14 },
    wl: { w: 3, l: 3, d: 0, recentForm: ["L", "W", "L"] },
    updatedAt: new Date().toISOString(),
  },
  {
    id: "design-library-demo-row-3",
    name: "New deck, no matches yet",
    href: "#",
    imageUrl: null,
    username: "you",
    price: null,
    updatedAt: null,
    isLast: true,
  },
];

const TYPE_ICONS = [
  "fire", "water", "grass", "lightning", "psychic", "fighting",
  "darkness", "metal", "fairy", "dragon", "colorless",
];

const SET_LOGO_EXAMPLES: { src: string | null; ptcgoCode: string | null; setName: string }[] = [
  { src: "/sets/me3.webp", ptcgoCode: "POR", setName: "Perfect Order" },
  { src: "/sets/me4.webp", ptcgoCode: "CRI", setName: "Chaos Rising" },
  { src: "/sets/me5.webp", ptcgoCode: "PBL", setName: "Pitch Black" },
  { src: null, ptcgoCode: null, setName: "Unresolved set — PTCGO fallback" },
];

// smallImageUrl is deliberately empty — CardPile's CardImage already falls
// back to a clean "No image" placeholder card (name/set/number) when a src
// is empty, so this needs no external image URLs.
const PLAYMAT_TILES: ResolvedDeckTile[] = [
  { key: "t1", name: "Dreepy", copyCount: 4, section: "pokemon", entryId: null, setName: "Twilight Masquerade", number: "96", smallImageUrl: "", largeImageUrl: "" },
  { key: "t2", name: "Dragapult ex", copyCount: 3, section: "pokemon", entryId: null, setName: "Twilight Masquerade", number: "130", smallImageUrl: "", largeImageUrl: "" },
  { key: "t3", name: "Iono", copyCount: 2, section: "trainer", entryId: null, setName: "Paldea Evolved", number: "185", smallImageUrl: "", largeImageUrl: "" },
];
const PLAYMAT_ROWS = computeRows(PLAYMAT_TILES);
const PLAYMAT_GRADIENT = MAT_STYLES.find((s) => s.key === "brand")!.gradient;
const PLAYMAT_TEXTURE = TEXTURES.find((t) => t.key === "dots")!;

export default function DesignLibraryClient() {
  const [pillValue, setPillValue] = useState("standard");
  const [gridListValue, setGridListValue] = useState<"grid" | "list">("grid");
  const [matStyle, setMatStyle] = useState(MAT_STYLES[0].key);
  const [textureKey, setTextureKey] = useState<string | null>(TEXTURES[0].key);

  function fireStreakToast() {
    window.dispatchEvent(
      new CustomEvent("dx:streak", {
        detail: { current: 4, longest: 6, changed: true },
      }),
    );
  }

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-text-primary">Design Library</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-2xl">
            Reference for TCG Dexter&apos;s real UI pieces — colors, buttons,
            badges, cards, and the shared components each product surface is
            built from. Use this to talk about UI work without re-deriving
            conventions from source each time. Most examples below render the
            actual shared components with sample data, not screenshots.
          </p>
        </header>

        {/* In-page section nav */}
        <nav className="mb-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-x-8 sm:gap-y-3 rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-4">
          {NAV.map((group) => (
            <div key={group.heading} className="min-w-[10rem]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                {group.heading}
              </div>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="text-xs font-semibold text-text-secondary hover:text-accent transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* ══════════════════════════ GLOBAL ══════════════════════════ */}

        <Section
          id="colors"
          eyebrow="Global"
          title="Color tokens"
          description="CSS custom properties defined in app/globals.css. Re-themed per value under .dark — component code should always reference the token, never the raw hex."
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {COLOR_TOKENS.map((t) => (
              <ColorSwatch key={t.name} {...t} />
            ))}
          </div>
          <div>
            <div
              className="h-16 rounded-xl"
              style={{ background: "var(--gradient-brand)" }}
            />
            <div className="mt-2">
              <div className="font-mono text-xs font-semibold text-text-primary">
                --gradient-brand
              </div>
              <div className="font-mono text-[11px] text-text-muted">
                linear-gradient(90deg, #F2A20C 0%, #D91E0D 50%, #A60D0D 100%) — unchanged in dark mode; brand identity doesn&apos;t shift with theme.
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="typography"
          eyebrow="Global"
          title="Typography"
          description="Geist Sans is the default (font-sans). Geist Mono (font-mono) is reserved for code / raw deck-list input. No custom font-size scale — Tailwind defaults only."
        >
          <Demo label="Type scale (font-sans)">
            <div className="flex flex-col gap-2">
              <p className="text-2xl font-semibold text-text-primary">text-2xl — 24px</p>
              <p className="text-xl font-semibold text-text-primary">text-xl — 20px</p>
              <p className="text-lg font-semibold text-text-primary">text-lg — 18px</p>
              <p className="text-base font-semibold text-text-primary">text-base — 16px</p>
              <p className="text-sm font-semibold text-text-primary">text-sm — 14px</p>
              <p className="text-xs font-semibold text-text-primary">text-xs — 12px</p>
            </div>
          </Demo>
          <Demo label="Weights in use">
            <div className="flex flex-wrap items-baseline gap-6 text-text-primary">
              <span className="text-base font-medium">font-medium</span>
              <span className="text-base font-semibold">font-semibold</span>
              <span className="text-base font-bold">font-bold</span>
              <span className="text-base font-extrabold">font-extrabold</span>
              <span className="text-base font-black">font-black</span>
            </div>
          </Demo>
          <Demo label="font-mono — deck list / code">
            <p className="font-mono text-xs text-text-primary">
              Pokémon: 13{"\n"}3 N&apos;s Zoroark ex JTG 175
            </p>
          </Demo>
        </Section>

        <Section
          id="buttons"
          eyebrow="Global"
          title="Buttons"
          description="Text buttons: text-xs font-semibold, px-3 py-1.5. Icon-only: px-3 py-[7px] (the extra 1px compensates for the missing text line-height). Black-fill buttons always pair with border border-transparent to match bordered-button height."
        >
          <Demo label="GradientButton — primary CTA (app/components/ui/GradientButton.tsx)">
            <div className="flex flex-wrap gap-3">
              <GradientButton onClick={() => {}}>Continue</GradientButton>
              <GradientButton onClick={() => {}} showIcon={false}>
                Save to collection
              </GradientButton>
              <GradientButton onClick={() => {}} disabled>
                Disabled
              </GradientButton>
            </div>
          </Demo>
          <Demo label="Pill buttons — bordered / accent-bordered / black-fill">
            <div className="flex flex-wrap gap-3">
              <button className="inline-flex items-center gap-1 rounded-full border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-black/5 transition-colors">
                Edit
              </button>
              <button className="inline-flex items-center gap-1 rounded-full border border-accent/30 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/5 transition-colors">
                Delete
              </button>
              <button className="rounded-full bg-black dark:bg-white border border-transparent px-3 py-1.5 text-xs font-semibold text-white dark:text-black hover:opacity-80 transition-opacity">
                Update
              </button>
              <button
                aria-label="Show details"
                className="rounded-full border border-black/10 dark:border-white/10 px-3 py-[7px] text-xs font-semibold text-text-primary hover:bg-black/5 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            </div>
          </Demo>
          <Demo label="Gradient-ring toggle — inactive / active (SavedDeckRow's Log match button)">
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold text-text-secondary transition-all"
                style={{
                  backgroundImage: "linear-gradient(var(--bg), var(--bg)), var(--gradient-brand)",
                  backgroundOrigin: "border-box",
                  backgroundClip: "padding-box, border-box",
                }}
              >
                Log match
              </button>
              <button
                className="rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold text-white transition-all"
                style={{
                  backgroundImage: "linear-gradient(var(--accent), var(--accent)), var(--gradient-brand)",
                  backgroundOrigin: "border-box",
                  backgroundClip: "padding-box, border-box",
                }}
              >
                Log match
              </button>
            </div>
          </Demo>
        </Section>

        <Section
          id="badges"
          eyebrow="Global"
          title="Badges & pills"
          description="Small status/metadata chips used across match history, pricing, and notifications."
        >
          <Demo label="W-L record pill + recent form pips (SavedDeckRow.tsx)">
            <div className="flex flex-wrap items-center gap-4">
              <RecordPill wl={{ w: 12, l: 4, d: 0 }} />
              <RecordPill />
              <FormPips recentForm={["W", "W", "L", "D", "W"]} />
            </div>
          </Demo>
          <Demo label="Match result badges (MatchLog.tsx RESULT_STYLE)">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold bg-gradient-brand text-white">W</span>
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold bg-black dark:bg-white text-white dark:text-black">L</span>
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold text-text-primary bg-white dark:bg-surface-elevated shadow-[inset_0_0_0_1px_black] dark:shadow-[inset_0_0_0_1px_white]">D</span>
            </div>
          </Demo>
          <Demo label="Price / shipping pill (ShopListingsPanel.tsx) & legality warning pill (DeckProfileView.tsx)">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                Free shipping
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-0.5 text-xs text-text-secondary">
                <span className="font-semibold">2</span>
                <span>Iono</span>
              </span>
            </div>
          </Demo>
          <Demo label="Notification count badge (NotificationBell.tsx)">
            <div className="flex items-center gap-6">
              <NotificationBell count={0} />
              <NotificationBell count={3} />
              <NotificationBell count={14} />
            </div>
          </Demo>
        </Section>

        <Section
          id="cards"
          eyebrow="Global"
          title="Cards & surfaces"
          description="The standard elevated card chrome used across DeckProfileView, profile pages, and the leaderboard — codified in SkeletonCard so loading and loaded states share one shape."
        >
          <Demo label="SkeletonCard chrome (app/components/skeletons/Skeleton.tsx)">
            <SkeletonCard>
              <p className="text-sm text-text-secondary">
                rounded-2xl · border-black/8 (dark: white/10) · bg-white/90 (dark:
                bg-surface-elevated) · backdrop-blur-xl · shadow-sm
              </p>
            </SkeletonCard>
          </Demo>
          <Demo label=".card-lift hover utility (globals.css) — hover to see it">
            <div className="card-lift inline-block rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated shadow-sm px-6 py-4 text-sm text-text-secondary">
              Hover me
            </div>
          </Demo>
        </Section>

        <Section
          id="loading"
          eyebrow="Global"
          title="Loading states"
          description="Skeleton primitives sized to match real content so the swap from skeleton to loaded HTML doesn't shift layout."
        >
          <Demo label="SkeletonLine / SkeletonCircle / SkeletonBlock">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <SkeletonCircle />
                <div className="flex flex-col gap-2">
                  <SkeletonLine width="w-32" />
                  <SkeletonLine width="w-20" height="h-2.5" />
                </div>
              </div>
              <SkeletonBlock height="h-16" />
            </div>
          </Demo>
          <Demo label="SkeletonRow inside SkeletonCard">
            <SkeletonCard padding="p-0">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow showTrailing={false} />
            </SkeletonCard>
          </Demo>
        </Section>

        <Section
          id="empty"
          eyebrow="Global"
          title="Empty states"
          description="Plain centered muted text for small in-place empties (e.g. a match list); a dedicated onboarding module for a page-level empty state."
        >
          <Demo label="Inline empty text (MatchLog.tsx)">
            <p className="text-sm text-text-muted text-center">
              No matches logged yet. Tap Log Match after your next game.
            </p>
          </Demo>
          <Demo label="Get Started module shape (GetStartedChecklist.tsx) — static reproduction, not the live component, since its Dismiss action writes to the viewer's own account">
            <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">Get started</h2>
                  <p className="text-xs text-text-muted tabular-nums mt-0.5">2 of 4 done</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-4">
                <p className="text-[15px] font-semibold text-text-primary">Log your first match</p>
                <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                  Track wins and losses to see your matchup spread over time.
                </p>
                <div className="mt-3">
                  <span className="inline-flex items-center justify-center rounded-full bg-gradient-brand px-4 py-2 text-sm font-semibold text-white shadow-sm">
                    Log a match
                  </span>
                </div>
              </div>
            </div>
          </Demo>
        </Section>

        <Section
          id="modals"
          eyebrow="Global"
          title="Modals & dialogs"
          description="Shared overlay recipe: fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm, portaled to <body>. Shown here without `fixed` positioning so it sits inline in the reference page instead of covering it."
        >
          <Demo
            label="Confirmation dialog shell (pattern shared by NewListDialog, DeleteAccountButton, DeckOwnershipModule)"
            className="border-solid bg-black/40 backdrop-blur-sm p-8 flex items-center justify-center"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]">
              <h2 className="text-base font-semibold text-text-primary">
                Are you sure you want to add all cards?
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                12 cards will be added to your catalog.
              </p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition">
                  Cancel
                </button>
                <button className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition">
                  Add
                </button>
              </div>
            </div>
          </Demo>
        </Section>

        <Section
          id="forms"
          eyebrow="Global"
          title="Form inputs"
          description="Labels are uppercase, tracking-wider, text-xs, text-muted. PillSelect and GridListToggle are live, interactive controls."
        >
          <Demo label="Labeled text input & textarea (NewDeckDialog.tsx)">
            <div className="flex flex-col gap-4 max-w-sm">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  Deck name
                </label>
                <input
                  type="text"
                  readOnly
                  value="Dragapult ex"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  Deck list
                </label>
                <textarea
                  readOnly
                  rows={3}
                  value={"Pokémon: 13\n3 N's Zoroark ex JTG 175"}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text-primary resize-none"
                />
              </div>
            </div>
          </Demo>
          <Demo label="PillSelect (app/components/ui/PillSelect.tsx)">
            <PillSelect value={pillValue} onChange={(e) => setPillValue(e.target.value)}>
              <option value="standard">Standard</option>
              <option value="expanded">Expanded</option>
              <option value="glc">GLC</option>
            </PillSelect>
          </Demo>
          <Demo label="GridListToggle (app/components/ui/GridListToggle.tsx)">
            <GridListToggle value={gridListValue} onChange={setGridListValue} />
          </Demo>
        </Section>

        <Section
          id="toasts"
          eyebrow="Global"
          title="Toasts"
          description="StreakToast is mounted once in the root layout and listens for a window `dx:streak` custom event — this button fires the real, already-mounted toast rather than a copy."
        >
          <Demo label="Streak toast (app/components/StreakToast.tsx)">
            <button
              onClick={fireStreakToast}
              className="rounded-full bg-black dark:bg-white border border-transparent px-3 py-1.5 text-xs font-semibold text-white dark:text-black hover:opacity-80 transition-opacity"
            >
              Show streak toast
            </button>
          </Demo>
        </Section>

        <Section
          id="avatars"
          eyebrow="Global"
          title="Avatars"
          description="Initial-letter circle as the fallback when no avatar_url is set (TrainerSearch.tsx)."
        >
          <Demo label="Initial-letter fallback">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black/[0.06] flex items-center justify-center text-sm font-semibold text-text-muted">
                A
              </div>
              <div className="w-8 h-8 rounded-full bg-black/[0.06] flex items-center justify-center text-sm font-semibold text-text-muted">
                T
              </div>
            </div>
          </Demo>
        </Section>

        <Section
          id="images"
          eyebrow="Global"
          title="Images & badges"
          description="Static brand assets in public/ — logos, favicon, achievement medallions, energy-type icons, and set logos. Shown against their own backdrop below since each is theme-specific and the page only renders one theme at a time."
        >
          <Demo label="Wordmark, light/dark pair (logo-wordmark-light.png / logo-wordmark-dark.png)">
            <div className="flex flex-wrap gap-3">
              <div className="rounded-xl bg-white p-4 flex items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-wordmark-light.png" alt="TCG Dexter" className="h-8 w-auto" />
              </div>
              <div className="rounded-xl bg-[#242424] p-4 flex items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-wordmark-dark.png" alt="TCG Dexter" className="h-8 w-auto" />
              </div>
            </div>
          </Demo>
          <Demo label="Icon mark (logo-light.png) — sign-in page, shared deck-profile header">
            <div className="rounded-xl bg-white p-4 inline-flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-light.png" alt="TCG Dexter" style={{ width: 120, height: "auto" }} />
            </div>
          </Demo>
          <Demo label="Favicon (favicon-source.png) — app/icon.tsx crops this to a 512×512 circle at request time via next/og">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon-source.png" alt="" className="w-16 h-16 rounded-lg" />
              <div className="w-16 h-16 rounded-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/favicon-source.png" alt="" className="w-full h-full object-cover" />
              </div>
            </div>
          </Demo>
          <Demo label="Achievement badges (BadgeShowcase.tsx) — live, unmodified, zero props">
            <BadgeShowcase />
          </Demo>
          <Demo label="Energy type icons (public/types/*.png)">
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-11 gap-4">
              {TYPE_ICONS.map((t) => (
                <div key={t} className="flex flex-col items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/types/${t}.png`} alt={t} className="w-8 h-8" />
                  <span className="text-[10px] text-text-muted capitalize">{t}</span>
                </div>
              ))}
            </div>
          </Demo>
          <Demo label="Set logos (SetLogo.tsx) — last one shows the graceful PTCGO-code fallback">
            <div className="flex flex-wrap items-center gap-4">
              {SET_LOGO_EXAMPLES.map((s) => (
                <SetLogo key={s.setName} src={s.src} ptcgoCode={s.ptcgoCode} setName={s.setName} className="shrink-0 w-16 h-12" />
              ))}
            </div>
          </Demo>
        </Section>

        {/* ══════════════════════════ BY PRODUCT ══════════════════════════ */}

        <Section
          id="catalog"
          eyebrow="Product"
          title="Card catalog"
          description="app/cards/ — the printing grid, per-card detail, and shop listings."
        >
          <Demo label="Grid tile chrome (GridTile.tsx) — static reproduction; the live component requires a full CardIndexEntry fixture">
            <div className="w-40 flex flex-col items-center gap-2">
              <div
                className="relative w-full rounded-xl overflow-hidden bg-surface"
                style={{ aspectRatio: "245 / 342" }}
              >
                <div className="absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-center gap-2 px-2 bg-gradient-to-b from-transparent to-neutral-800 to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums">
                  <span className="min-w-0 truncate rounded-md border border-white/70 bg-black px-0.5 py-0.5">
                    TWM
                  </span>
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 truncate">
                    130/167
                  </span>
                  <span className="ml-auto shrink-0 aspect-square rounded-full border border-white/70 bg-black px-0.5 py-0.5 flex items-center justify-center">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      <path d="M10 4v12M4 10h12" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 items-center w-full gap-2">
                <span className="text-xs font-semibold tabular-nums text-text-primary truncate pl-2">
                  $24.99
                </span>
                <span className="justify-self-end rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
                  0
                </span>
              </div>
            </div>
          </Demo>
          <Demo label="Shop listings (ShopListingsPanel.tsx)">
            <ShopListingsPanel listings={SHOP_LISTINGS} />
          </Demo>
        </Section>

        <Section
          id="battles"
          eyebrow="Product"
          title="Battles"
          description="app/battles/ and match logging — composition mix, win/loss record, and the Featured Battle hero."
        >
          <Demo label="Composition bar (SavedDeckRow.tsx)">
            <CompositionBar counts={{ pokemon: 14, trainer: 32, energy: 14 }} />
          </Demo>
          <Demo label="Match row (MatchLog.tsx) — result badge, subtitle, view/edit/delete actions">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold bg-gradient-brand text-white">
                W
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-text-primary truncate text-sm">
                  Charizard ex
                </span>
                <p className="text-xs text-text-muted mt-0.5">6–3 v ashk_champ</p>
              </div>
              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-black/10 bg-white dark:bg-surface-2 px-3 py-1 text-[11px] font-semibold text-text-primary">
                View Battle
              </span>
            </div>
          </Demo>
          <Demo label="Battle preview cards (MatchCard.tsx) — win / loss / draw. Same grid wrapper as /battles, the home page, and a profile's Recent Battles.">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {BATTLE_PREVIEW_CARDS.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          </Demo>
          <Demo label="Featured Battle hero (FeaturedMatchHero.tsx) — the image-rich ghost-card/prize-digit/VS-glyph layout above appears on the preview cards too once both sides have resolved battle-log art">
            <FeaturedMatchHero match={FEATURED_MATCH} />
          </Demo>
        </Section>

        <Section
          id="meta"
          eyebrow="Product"
          title="Meta archetypes"
          description="app/meta-archetypes/[slug]/ — top-variant preview cards feeding DeckProfileView with variant=&quot;meta&quot;, which suppresses the Standard-legality banner (these decks are already current tournament results)."
        >
          <Demo label="Meta variant card (MetaVariantCard.tsx)" className="bg-surface" contentClassName="max-w-sm">
            <MetaVariantCard
              id="design-library-demo-variant"
              archetypeId="design-library-demo-archetype"
              archetypeName="Dragapult ex"
              variantName="Dragapult Noivern"
              iconUrl={null}
              iconBg="#8E6FBE"
              placingLine="3rd Place"
              competitionName="Regional, Indianapolis, IN"
              dateLine="Aug 10, 2026"
              creator="ashk_champ"
              cardImageUrl={null}
              secondaryAvatars={[]}
            />
          </Demo>
        </Section>

        <Section
          id="deck-profile"
          eyebrow="Product"
          title="Deck profile / analysis"
          description="app/components/DeckProfileView.tsx composes these modules plus DeckCardGrid/DeckListCard (shown here as parts, not as one mounted page, since the full view needs a complete analysis-result payload)."
        >
          <Demo label="Mulligan Risk (DeckMulliganModule.tsx)">
            <DeckMulliganModule deckSize={60} basicCount={9} basics={MULLIGAN_BASICS} />
          </Demo>
          <Demo label="Estimated deck price (DeckPriceModule.tsx)">
            <DeckPriceModule deckPrice={214.87} />
          </Demo>
          <Demo label="Cards Owned (DeckOwnershipModule.tsx)">
            <DeckOwnershipModule cards={OWNERSHIP_CARDS} />
          </Demo>
          <Demo label="Standard Format legality warning (DeckProfileView.tsx pattern) + info modal (StandardFormatInfo.tsx)">
            <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm px-5 py-4">
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-text-primary">Not legal in Standard Format</p>
                    <StandardFormatInfo />
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">2 cards no longer legal</p>
                </div>
              </div>
            </div>
          </Demo>
        </Section>

        <Section
          id="library"
          eyebrow="Product"
          title="Saved deck library"
          description="app/my-decks/ — SavedDeckRow is the list-view row; tapping it navigates to the deck profile, Log Match expands an inline form."
        >
          <Demo label="Saved deck rows (SavedDeckRow.tsx)">
            <div className="rounded-2xl border border-black/8 dark:border-white/10 overflow-hidden">
              {SAVED_DECK_ROWS.map((row) => (
                <SavedDeckRow key={row.id} {...row} />
              ))}
            </div>
          </Demo>
          <CodeNote>
            Row ids above are deliberately non-UUID placeholders — SavedDeckRow&apos;s
            Log Match flow does hit the real /api/matches endpoint on submit, and
            these ids fail validation cleanly rather than writing to real data.
          </CodeNote>
        </Section>

        <Section
          id="playmat"
          eyebrow="Product"
          title="Playmat Studio"
          description="app/admin-tools/deck-mat/ — a saved deck laid out as fanned card piles on a mat background the user picks (gradient, texture, or an uploaded photo), exported as a PNG. The full editor composes these pieces with live deck selection and canvas export; shown here are its presentational, reusable pieces."
        >
          <Demo label="Mat surface (DeckMatClient.tsx) — CardPile with mock tiles, MAT_STYLES gradient + TEXTURES pattern">
            <div
              className="relative rounded-xl overflow-hidden max-w-md"
              style={{
                padding: MAT_PADDING,
                backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(PLAYMAT_TEXTURE.svg)}"), ${PLAYMAT_GRADIENT}`,
                backgroundSize: `${PLAYMAT_TEXTURE.w}px ${PLAYMAT_TEXTURE.h}px, auto`,
                boxShadow: "0 4px 4px rgba(0,0,0,0.66)",
              }}
            >
              <div className="flex" style={{ gap: ROW_GAP_X }}>
                {PLAYMAT_ROWS[0]?.map((t, i) => (
                  <CardPile key={t.key} tile={t} cardWidth={60} index={i} />
                ))}
              </div>
            </div>
          </Demo>
          <Demo label="Mat style picker (MAT_STYLES) — click a swatch">
            <div className="grid gap-1.5 [grid-template-columns:repeat(11,1.75rem)]">
              {MAT_STYLES.map(({ key, gradient }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMatStyle(key)}
                  aria-label={key}
                  className={`w-7 h-7 rounded-full transition-all ${
                    matStyle === key
                      ? "ring-2 ring-black dark:ring-white ring-offset-1 ring-offset-[#f2f2f2] dark:ring-offset-[#242424] scale-110"
                      : "hover:ring-1 hover:ring-black/25 hover:ring-offset-1 hover:ring-offset-[#f2f2f2]"
                  }`}
                  style={{ background: gradient }}
                />
              ))}
            </div>
          </Demo>
          <Demo label="Texture picker (TEXTURES) — click a swatch">
            <div className="grid gap-1.5 [grid-template-columns:repeat(11,1.75rem)]">
              {TEXTURES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTextureKey((prev) => (prev === t.key ? null : t.key))}
                  aria-label={t.key}
                  className={`w-7 h-7 rounded-full transition-all ${
                    textureKey === t.key
                      ? "ring-2 ring-black dark:ring-white ring-offset-1 ring-offset-[#f2f2f2] dark:ring-offset-[#242424] scale-110"
                      : "hover:ring-1 hover:ring-black/25 hover:ring-offset-1 hover:ring-offset-[#f2f2f2]"
                  }`}
                  style={{
                    backgroundColor: "#3a3a3a",
                    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(t.svg)}")`,
                    backgroundSize: `${t.w}px ${t.h}px`,
                  }}
                />
              ))}
            </div>
          </Demo>
          <Demo label="Add Image / Export buttons — static reference; the real ones open a file picker and run a canvas rasterizer">
            <div className="flex flex-col items-start gap-2 max-w-[368px]">
              <button className="w-full py-2.5 rounded-full border border-black/15 bg-white text-sm font-semibold text-text-primary dark:text-black hover:bg-black/[0.03] transition-colors inline-flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 15-5-5L5 21" />
                </svg>
                Add Image
              </button>
              <button
                className="w-full py-2.5 rounded-full text-sm font-semibold text-white transition-opacity"
                style={{ background: "var(--gradient-brand)" }}
              >
                Export
              </button>
            </div>
          </Demo>
        </Section>
      </div>
    </main>
  );
}
