import Link from "next/link";
import DeckCardGrid from "@/app/components/DeckCardGrid";
import DeckListCard from "@/app/components/DeckListCard";
import DeckMulliganModule from "@/app/components/DeckMulliganModule";
import DeckPriceModule from "@/app/components/DeckPriceModule";
import MetaDeckListCarousel from "@/app/components/MetaDeckListCarousel";
import SaveDeckButton from "@/app/components/SaveDeckButton";
import ShareButton from "@/app/components/ShareButton";
import StandardFormatInfo from "@/app/components/StandardFormatInfo";

/* ─── Types ──────────────────────────────────────────────────── */

export interface ShopListing {
  title: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  listingUrl: string;
  condition: string;
  bestOffer: boolean;
  itemId: string;
}

export interface PokemonAbility {
  pokemonName: string;
  abilityName: string;
  description: string;
}

export interface PokemonAttack {
  pokemonName: string;
  attackName: string;
  cost: string[];
  damage: string;
  description: string;
}

export interface AnalysisResult {
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
    /** @deprecated No longer read by the renderer — the Overview matrix now
     *  re-derives types from `cards` against the bundled card DB at render
     *  time (see `buildTypesByName` in `lib/cardTypes.ts`). Still emitted by
     *  the analyzer and persisted on older saved-deck rows; safe to ignore. */
    typesByName?: Record<string, string[]>;
  };
  trainer: {
    totalCards: number;
    uniqueCards: number;
    supporterCount: number;
    itemCount: number;
    toolCount: number;
    stadiumCount: number;
    details: Array<{ name: string; description: string }>;
  };
  energy: {
    totalCards: number;
    basicByType: Record<string, number>;
    basicCount: number;
    specialCount: number;
    specialDetails: Array<{ name: string; qty: number; description: string }>;
  };
  deckPrice: number;
  deckScore?: {
    total: number;
    grade: string;
    rotation: number;
    consistency: number;
    evolution: number;
    energyFit: number;
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
    rank: number | null;
    conversionRate: number | null;
  };
  cards: Array<{
    qty: number;
    name: string;
    number: string;
    setCode: string;
    section: "pokemon" | "trainer" | "energy";
  }>;
  warnings: string[];
  shopMatches: Array<{
    cardName: string;
    listings: ShopListing[];
  }>;
}

/* ─── Energy styling ─────────────────────────────────────────── */

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

const ENERGY_COLORS: Record<string, string> = {
  Fire: "bg-red-100 text-black border-red-200",
  Water: "bg-blue-100 text-black border-blue-200",
  Grass: "bg-green-100 text-black border-green-200",
  Lightning: "bg-yellow-100 text-black border-yellow-200",
  Psychic: "bg-violet-100 text-black border-violet-200",
  Fighting: "bg-amber-100 text-black border-amber-200",
  Darkness: "bg-teal-400 text-black border-teal-600",
  Metal: "bg-zinc-100 text-black border-zinc-200",
  Fairy: "bg-pink-100 text-black border-pink-200",
  Dragon: "bg-amber-100 text-black border-amber-200",
  Colorless: "bg-stone-100 text-black border-stone-200",
};

const ENERGY_LETTER: Record<string, string> = {
  Fire: "R",
  Water: "W",
  Grass: "G",
  Lightning: "L",
  Psychic: "P",
  Fighting: "F",
  Darkness: "D",
  Metal: "M",
  Fairy: "Y",
  Dragon: "N",
  Colorless: "C",
};

function EnergyCostPill({ type }: { type: string }) {
  const colorClass =
    ENERGY_COLORS[type] ?? "bg-stone-100 text-stone-400 border-stone-200";
  const letter = ENERGY_LETTER[type] ?? type[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border w-5 h-5 text-xs font-bold ${colorClass}`}
      title={type}
    >
      {letter}
    </span>
  );
}

function CollapsibleSection({
  title,
  children,
  badge,
  cardClass = "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm",
}: {
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
  cardClass?: string;
}) {
  return (
    <details className={`${cardClass} p-5 group`}>
      <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold">{title}</h2>
        <svg
          className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </summary>
      {badge && <div className="flex gap-2 flex-wrap mt-4 mb-4">{badge}</div>}
      <div className="mt-4">{children}</div>
    </details>
  );
}

function StatPill({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-3 py-1 text-sm text-text-secondary">
      <span className="font-semibold">{count}</span>
      <span className="font-normal">{label}</span>
    </span>
  );
}

/* ─── DeckProfileView ────────────────────────────────────────── */

export interface DeckCreator {
  displayName: string;
}

interface Props {
  /**
   * Which variant of the deck profile this is. Controls logo visibility,
   * save/share button layout, and default footer CTA.
   *
   * - "fresh"  — freshly generated on home page; no logo (rendered above),
   *              save + share two-button row.
   * - "saved"  — viewing a saved deck (/my-decks/[id]); no logo,
   *              share button fills the full row (no save button).
   * - "shared" — public shared link (/d/[shortId]); logo shown,
   *              save + share two-button row.
   * - "meta"   — meta archetype page; no logo,
   *              save + share two-button row.
   */
  variant: "fresh" | "saved" | "shared" | "meta";
  deckList: string;
  /**
   * Optional sibling deck-list strings to render as a horizontal carousel
   * alongside the primary `deckList`. Currently only consumed by the meta
   * variant. The first entry should be `deckList` itself (or an equivalent).
   */
  deckLists?: string[];
  /**
   * Per-variant creator/trainer names parallel to `deckLists`. Surfaced
   * beneath the variant index inside `MetaDeckListCarousel`.
   */
  deckListCreators?: string[];
  analysis: AnalysisResult;
  profiledAt: string;
  /** Page heading; defaults to "Deck Profile". */
  pageTitle?: string;
  /** Optional element rendered inline after the page heading (e.g. a pencil rename button). */
  titleAction?: React.ReactNode;
  /** Optional element rendered inline before the page heading (e.g. a deck creator avatar). */
  titleLeading?: React.ReactNode;
  /** Optional element rendered above the page heading (e.g. a back navigation link). */
  preTitle?: React.ReactNode;
  /** Subtitle line below the heading; defaults to "Created on <date>". Accepts a ReactNode for custom content. */
  subtitle?: React.ReactNode;
  /**
   * Footer CTA content. Defaults to a "Profile your own deck" link.
   * Pass `null` to suppress the footer CTA entirely (e.g. meta deck pages
   * that don't need a "profile your own" nudge).
   */
  footerCta?: React.ReactNode | null;
  /** Optional creator info — shown as a badge card below the header. */
  creator?: DeckCreator;
  /**
   * Content injected above the price module.
   * Used by /my-decks/[id] to slot in the match log + notes,
   * and by /meta-archetypes/[slug] for stat cards + scouting note.
   */
  topSlot?: React.ReactNode;
  /**
   * Content injected immediately before the Overview matrix on all variants.
   * - saved: action buttons + match log
   * - meta: "#N in Standard" rank eyebrow
   * - fresh/shared: unused
   */
  preOverviewSlot?: React.ReactNode;
  /**
   * Content injected directly below the Save/Share button row.
   * Used by /meta-archetypes/[slug] to place the Scouting Note after the CTAs.
   */
  postCtaSlot?: React.ReactNode;
  /**
   * Canonical share URL for this deck profile. When provided, ShareButton
   * uses it directly (skipping POST /api/deck-share) so all share/copy/QR
   * flows surface the trainer-namespaced URL instead of minting a fresh
   * /d/[shortId]. Set on /u/[username]/[deckId] and on /my-decks/[id]
   * when the deck is public.
   */
  shareUrl?: string;
  /**
   * Optional escape hatch — when provided, replaces the default text
   * header treatment (pageTitle / preTitle / subtitle). Used by the
   * meta deck profile to render a Twitter-style banner + avatar + bio
   * header in place of the centered text block.
   */
  headerSlot?: React.ReactNode;
}

/**
 * Full deck profile view. Used by both the public shared-deck page
 * (/d/[shortId]) and the private saved-deck view (/my-decks/[id]).
 *
 * Server component that embeds a handful of client islands (DeckPriceModule,
 * SaveDeckButton, StandardFormatInfo, ThemeColor, EnergyColor).
 */
export default function DeckProfileView({
  variant,
  deckList,
  deckLists,
  deckListCreators,
  analysis,
  profiledAt,
  pageTitle = "Deck Profile",
  titleAction,
  titleLeading,
  preTitle,
  subtitle,
  footerCta,
  creator,
  topSlot,
  preOverviewSlot,
  postCtaSlot,
  shareUrl,
  headerSlot,
}: Props) {
  const result = analysis;
  const CARD_CLS = "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm";
  const TRACK_CLS = "bg-black/5";
  const SUBCARD_CLS = "border border-black/8 rounded-xl overflow-hidden";
  const SUBHEADER_CLS = "bg-[#fafafa]";
  const dateStr = new Date(profiledAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const effectiveSubtitle = subtitle ?? `Created on ${dateStr}`;

  const defaultFooterCta = (
    <Link
      href="/"
      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
    >
      Profile your own deck
    </Link>
  );

  const overviewNode = <DeckCardGrid cards={result.cards} />;

  return (
    <div className="min-h-dvh flex flex-col bg-bg">

      {/* Back button anchored at the very top of available space
          (desktop-only; mobile portals into the toolbar). Matches the
          meta archetype page's flush-top placement. */}
      {preTitle && (
        <div className="hidden xl:block px-6 pt-[calc(env(safe-area-inset-top)_+_0.75rem)]">
          {preTitle}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────── */}
      {headerSlot ?? (
        <header
          className={`flex-shrink-0 px-6 pt-[calc(env(safe-area-inset-top)_+_1.75rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] ${
            preTitle ? "xl:pt-8" : ""
          } ${effectiveSubtitle ? "pb-8" : "pb-4"}`}
        >
          {variant === "shared" && (
            <div className="flex justify-center mb-4">
              <img
                src="/logo-light.png"
                alt="TCG Dexter"
                className="max-w-full"
                style={{ width: "288px", height: "auto" }}
              />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              {titleLeading}
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-on-gradient">
                {pageTitle}
              </h1>
              {titleAction}
            </div>
            {effectiveSubtitle && (
              <div className="mt-2 text-sm text-on-gradient-muted">
                {effectiveSubtitle}
              </div>
            )}
          </div>
        </header>
      )}

      {/* ── Results ────────────────────────────────────────── */}
      <main className="flex-1 px-6 pb-20">
        <div className="flex flex-col gap-4">

          {/* Creator attribution */}
          {creator && (
            <div className={`flex items-center ${CARD_CLS} px-4 py-3`}>
              <p className="text-sm font-semibold text-text-primary truncate">
                {creator.displayName}
              </p>
            </div>
          )}

          {/* ── Pre-overview slot: action buttons (saved), rank label (meta) ── */}
          {preOverviewSlot}

          {/* ── Overview — always at the top across all variants ── */}
          {overviewNode}

          {/* Deck List — meta variant with multiple variants gets the carousel,
              all other variants get the standard collapsible card. */}
          {variant === "meta" && deckLists && deckLists.length > 1 ? (
            <MetaDeckListCarousel
              deckLists={deckLists}
              creators={deckListCreators}
            />
          ) : (
            <DeckListCard deckList={deckList} />
          )}

          {/* Estimated Deck Price */}
          <DeckPriceModule deckPrice={result.deckPrice} />

          {/* Mulligan Rate */}
          <DeckMulliganModule
            deckSize={result.deckSize}
            basicCount={result.pokemon.basicCount}
          />

          {/* ── Top slot: deck notes (saved/public); stat cards + record (meta) ── */}
          {topSlot}

          {/* Save + Share buttons — layout depends on variant */}
          {variant === "saved" ? (
            /* Saved variant: share fills the full row; no save button */
            <ShareButton
              deckList={deckList}
              analysis={result}
              shareUrl={shareUrl}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            />
          ) : (
            /* All other variants: Save (black) + Share side by side */
            <div className="flex gap-3">
              <SaveDeckButton
                deckList={deckList}
                analysis={result}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-black/85 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <ShareButton
                deckList={deckList}
                analysis={result}
                shareUrl={shareUrl}
                publishMode={variant === "fresh"}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          )}

          {/* Post-CTA slot (meta variant uses this for the Scouting Note) */}
          {postCtaSlot}

          {/* Standard Format legality warning (only when not legal) */}
          {!result.rotation.ready && (
            <div
              className={`${CARD_CLS} px-5 py-4`}
            >
              <div className="flex items-center gap-3 mb-3">
                <svg
                  className="w-4 h-4 text-amber-500 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-text-primary">
                      Not legal in Standard Format
                    </p>
                    <StandardFormatInfo />
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    {result.rotation.rotatingCount} card
                    {result.rotation.rotatingCount !== 1 ? "s" : ""} no longer
                    legal
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-7">
                {result.rotation.rotatingCards.map((c) => (
                  <span
                    key={c.name}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-0.5 text-xs text-text-secondary"
                  >
                    <span className="font-semibold">{c.qty}</span>
                    <span>{c.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Warnings — grouped here with the legality banner so all
              "things to fix" live together near the top. */}
          {result.warnings.length > 0 && (
            <div
              className={`${CARD_CLS} p-5`}
            >
              <h3
                className="text-sm font-semibold mb-2 flex items-center gap-2 text-text-primary"
              >
                <svg
                  className="w-4 h-4 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                Warnings
              </h3>
              <ul className="space-y-1">
                {result.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="text-sm text-text-secondary"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}


          {/* Pokemon */}
          <CollapsibleSection
            cardClass={CARD_CLS}
            title="Pok&eacute;mon"
            badge={
              <>
                {[
                  { count: result.pokemon.totalCards, label: "Total" },
                  { count: result.pokemon.uniqueSpecies, label: "Unique" },
                  ...(result.pokemon.basicCount > 0
                    ? [{ count: result.pokemon.basicCount, label: "Basic" }]
                    : []),
                  ...(result.pokemon.stage1Count > 0
                    ? [{ count: result.pokemon.stage1Count, label: "Stage 1" }]
                    : []),
                  ...(result.pokemon.stage2Count > 0
                    ? [{ count: result.pokemon.stage2Count, label: "Stage 2" }]
                    : []),
                ].map(({ count, label }) => (
                  <StatPill key={label} count={count} label={label} />
                ))}
              </>
            }
          >
            {result.pokemon.abilities.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-text-secondary mb-2">
                  Abilities
                </h3>
                <div className="flex flex-col gap-3">
                  {(() => {
                    const grouped = result.pokemon.abilities.reduce<
                      Record<string, PokemonAbility[]>
                    >((acc, ab) => {
                      if (!acc[ab.pokemonName]) acc[ab.pokemonName] = [];
                      acc[ab.pokemonName].push(ab);
                      return acc;
                    }, {});
                    return Object.entries(grouped).map(
                      ([pokemonName, abilities]) => (
                        <div
                          key={pokemonName}
                          className={SUBCARD_CLS}
                        >
                          <div className={`${SUBHEADER_CLS} px-4 py-2`}>
                            <span className="text-sm font-semibold text-text-primary">
                              {pokemonName}
                            </span>
                          </div>
                          <div className="divide-y divide-border">
                            {abilities.map((ab, i) => (
                              <div key={i} className="bg-bg px-4 py-3">
                                <span className="font-semibold text-sm text-accent">
                                  {ab.abilityName}
                                </span>
                                {ab.description && (
                                  <p className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                                    {ab.description}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ),
                    );
                  })()}
                </div>
              </div>
            )}

            {result.pokemon.attacks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-text-secondary mb-2">
                  Attacks
                </h3>
                <div className="flex flex-col gap-3">
                  {(() => {
                    const grouped = result.pokemon.attacks.reduce<
                      Record<string, PokemonAttack[]>
                    >((acc, atk) => {
                      if (!acc[atk.pokemonName]) acc[atk.pokemonName] = [];
                      acc[atk.pokemonName].push(atk);
                      return acc;
                    }, {});
                    return Object.entries(grouped).map(
                      ([pokemonName, attacks]) => (
                        <div
                          key={pokemonName}
                          className={SUBCARD_CLS}
                        >
                          <div className={`${SUBHEADER_CLS} px-4 py-2`}>
                            <span className="text-sm font-semibold text-text-primary">
                              {pokemonName}
                            </span>
                          </div>
                          <div className="divide-y divide-border">
                            {attacks.map((atk, i) => (
                              <div key={i} className="bg-bg px-4 py-3">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="font-semibold text-text-primary text-sm">
                                    {atk.attackName}
                                  </span>
                                  {atk.cost.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {atk.cost.map((type, j) => (
                                        <EnergyCostPill key={j} type={type} />
                                      ))}
                                    </div>
                                  )}
                                  {atk.damage && (
                                    <span className="ml-auto font-bold text-text-primary text-sm">
                                      {atk.damage}
                                    </span>
                                  )}
                                </div>
                                {atk.description && (
                                  <p className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                                    {atk.description}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ),
                    );
                  })()}
                </div>
              </div>
            )}

            {result.pokemon.abilities.length === 0 &&
              result.pokemon.attacks.length === 0 && (
                <p className="text-sm text-text-muted italic">
                  No ability or attack data found.
                </p>
              )}
          </CollapsibleSection>

          {/* Trainer */}
          <CollapsibleSection
            cardClass={CARD_CLS}
            title="Trainer"
            badge={
              <>
                {[
                  { count: result.trainer.totalCards, label: "Total" },
                  { count: result.trainer.uniqueCards, label: "Unique" },
                  ...(result.trainer.supporterCount > 0
                    ? [
                        {
                          count: result.trainer.supporterCount,
                          label: "Supporter",
                        },
                      ]
                    : []),
                  ...(result.trainer.itemCount > 0
                    ? [{ count: result.trainer.itemCount, label: "Item" }]
                    : []),
                  ...(result.trainer.toolCount > 0
                    ? [{ count: result.trainer.toolCount, label: "Tool" }]
                    : []),
                  ...(result.trainer.stadiumCount > 0
                    ? [
                        {
                          count: result.trainer.stadiumCount,
                          label: "Stadium",
                        },
                      ]
                    : []),
                ].map(({ count, label }) => (
                  <StatPill key={label} count={count} label={label} />
                ))}
              </>
            }
          >
            {result.trainer.details.length > 0 ? (
              <div className="flex flex-col gap-3">
                {result.trainer.details.map((t) => (
                  <div
                    key={t.name}
                    className={SUBCARD_CLS}
                  >
                    <div className={`${SUBHEADER_CLS} px-4 py-2`}>
                      <span className="text-sm font-semibold text-text-primary">
                        {t.name}
                      </span>
                    </div>
                    <div className="bg-bg px-4 py-3">
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {t.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted italic">
                No trainer details available.
              </p>
            )}
          </CollapsibleSection>

          {/* Energy */}
          <CollapsibleSection
            cardClass={CARD_CLS}
            title="Energy"
            badge={
              <>
                {[
                  { count: result.energy.totalCards, label: "Total" },
                  ...Object.entries(result.energy.basicByType).map(
                    ([type, count]) => ({
                      count,
                      label: `Basic ${type}`,
                    }),
                  ),
                  ...(result.energy.specialCount > 0
                    ? [
                        {
                          count: result.energy.specialCount,
                          label: "Special",
                        },
                      ]
                    : []),
                ].map(({ count, label }) => (
                  <StatPill key={label} count={count} label={label} />
                ))}
              </>
            }
          >
            {result.energy.specialDetails.length > 0 ? (
              <div className="flex flex-col gap-3">
                {result.energy.specialDetails.map((e) => (
                  <div
                    key={e.name}
                    className={SUBCARD_CLS}
                  >
                    <div className={`${SUBHEADER_CLS} px-4 py-2 flex items-center justify-between`}>
                      <span className="text-sm font-semibold text-text-primary">
                        {e.name}
                      </span>
                      <span className="text-xs text-text-secondary">
                        &times;{e.qty}
                      </span>
                    </div>
                    {e.description && (
                      <div className="bg-bg px-4 py-3">
                        <p className="text-xs text-text-secondary leading-relaxed">
                          {e.description}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted italic">
                No special energy details.
              </p>
            )}
          </CollapsibleSection>

          {/* Shop Matches */}
          {result.shopMatches.length > 0 && (
            <div
              className="rounded-2xl p-[1.5px] bg-gradient-brand shadow-sm"
            >
            <details
              className="rounded-[14.5px] bg-white/95 backdrop-blur-xl p-5 group"
            >
              <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">
                    Available in the Shop
                  </h2>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Check out cards from this deck on eBay
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </summary>
              <div className="divide-y divide-border mt-4">
                {result.shopMatches.flatMap((match) =>
                  match.listings.map((listing) => (
                    <div
                      key={listing.itemId}
                      className="py-3 flex items-center gap-4"
                    >
                      {listing.imageUrl && (
                        <img
                          src={listing.imageUrl}
                          alt={listing.title}
                          className="w-12 h-12 object-contain rounded flex-shrink-0"
                        />
                      )}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold text-text-primary">
                          {match.cardName}
                        </span>
                        <span className="text-sm text-text-secondary">
                          ${listing.price.toFixed(2)}
                        </span>
                      </div>
                      <a
                        href={listing.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-text-primary hover:border-accent/40 hover:text-accent transition-colors"
                      >
                        View
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    </div>
                  )),
                )}
              </div>
            </details>
            </div>
          )}

          {/* Footer CTA — null suppresses entirely, undefined uses default */}
          {footerCta !== null && (
            <div className="text-center mt-4">{footerCta ?? defaultFooterCta}</div>
          )}
        </div>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer
        className="flex-shrink-0 pt-8 px-6 text-center text-sm text-text-muted"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
        }}
      >
        <p>&copy; 2026 TCG Dexter &middot; tcgdexter.com</p>
        <p className="mt-3 max-w-lg mx-auto text-xs text-text-muted/70 leading-relaxed">
          TCG Dexter is an independent organization. The information presented
          on this website about the Pok&eacute;mon Trading Card Game,
          including images and text, is intellectual property of The Pokémon
          Company, Nintendo, Game Freak, Creatures and/or Wizards of the
          Coast. TCG Dexter is not produced by, endorsed by, supported by, or
          affiliated with any of these companies.
        </p>
      </footer>
    </div>
  );
}
