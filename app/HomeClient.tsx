"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DeckProfileView, {
  type AnalysisResult,
} from "@/app/components/DeckProfileView";
import { popDeckList } from "@/lib/home-restore";
import SectionHeader from "@/app/components/ui/SectionHeader";
import GradientButton from "@/app/components/ui/GradientButton";
import StatsStrip from "@/app/components/ui/StatsStrip";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import { MetaDeckCard } from "@/app/components/DeckPostCard";
import { metaPrimaryCard, typeColor } from "@/lib/metaPrimaryCard";
import { MatchCard, type RecentMatch } from "@/app/components/MatchCard";
import SpotlightBanner from "@/app/spotlight/components/SpotlightBanner";
import type {
  SpotlightBannerLayout,
  SpotlightCardRef,
  SpotlightPokemonRef,
} from "@/app/spotlight/types";
import PlaymatShowcase from "./PlaymatShowcase";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import UnifiedSearch from "@/app/leaderboard/UnifiedSearch";
import type { CardIndexEntry, RawCard } from "@/lib/cardsIndex";
import GridTile from "@/app/cards/GridTile";
import CardDetailPanel from "@/app/cards/CardDetailPanel";
import InventoryProvider, { useInventory } from "@/app/cards/InventoryContext";

export type CurrentSpotlight = {
  id: string;
  slug: string;
  username: string;
  layout: SpotlightBannerLayout;
  favoritePokemon: SpotlightPokemonRef | null;
  favoriteCollectionCards: SpotlightCardRef[];
  favoriteFormatCards: SpotlightCardRef[];
  userImageUrl: string | null;
  accentColors: (string | null)[];
};

const EXAMPLE_DECK = `Pokémon: 13
1 Meowth ex POR 62
1 N's Darmanitan JTG 27
3 N's Zoroark ex JTG 175
1 Munkidori TWM 95
1 Pecharunt ex SFA 39
1 N's Zorua PR-SV 189
1 Fezandipiti ex ASC 142
3 N's Zorua ASC 136
1 N's Zoroark ex JTG 189
2 N's Reshiram ASC 154
2 N's Zekrom ASC 155
1 Budew ASC 16
1 N's Darumaka JTG 26

Trainer: 15
2 Poké Pad ASC 198
4 N's PP Up ASC 195
3 Lillie's Determination ASC 192
1 Night Stretcher MEG 173
2 Janine's Secret Art SFA 59
2 Boss's Orders MEG 114
1 Night Stretcher SFA 61
2 Black Belt's Training PRE 96
4 Ultra Ball MEG 131
1 Air Balloon MEG 166
4 Buddy-Buddy Poffin MEG 167
2 N's Castle JTG 152
1 Hyper Aroma TWM 152
2 Team Rocket's Petrel DRI 176
2 Binding Mochi SFA 55

Energy: 1
8 Basic {D} Energy MEE 7

Total Cards: 60`;

interface Archetype {
  id: string;
  name: string;
  total_entries: number;
  top_cut_entries: number;
  representation_pct: number;
  conversion_rate: number;
  velocity: number;
  wins: number;
  losses: number;
  ties: number;
  icons?: string;
  image_url?: string;
}

interface MetaDeckEntry {
  id: string;
  cards: Array<{ qty: number; name: string; setCode: string; number: string; category: "pokemon" | "trainer" | "energy" }>;
  variants?: Array<{ cards: MetaDeckEntry["cards"]; creator?: string }>;
}

// Pre-compute the top-3 preview cards using the same prep loop that drives
// /meta-archetypes: pick the face Pokémon card from each archetype's deck list,
// pull its energy-type color, and surface up to five creators.
const top3Cards = (() => {
  const top3 = (archetypesRaw as Archetype[])
    .sort((a, b) => b.total_entries - a.total_entries)
    .slice(0, 3);
  const metaDecks = metaDecksRaw as MetaDeckEntry[];
  return top3.map((arch) => {
    const deckData = metaDecks.find((d) => d.id === arch.id);
    const cards = deckData?.variants?.[0]?.cards ?? deckData?.cards ?? [];
    let iconList: string[] = [];
    try {
      iconList = arch.icons ? (JSON.parse(arch.icons) as string[]) : [];
    } catch {
      iconList = [];
    }
    const primary = metaPrimaryCard(cards, iconList);
    const cardImage = primary?.imageUrl ?? arch.image_url ?? null;
    const iconBg = typeColor(primary?.types);
    const iconUrl = iconList[0]
      ? `https://r2.limitlesstcg.net/pokemon/gen9/${iconList[0]}.png`
      : null;
    const creators: string[] = [];
    for (const v of deckData?.variants ?? []) {
      const c = (v.creator ?? "").trim() || "Trainer";
      if (!creators.includes(c)) creators.push(c);
      if (creators.length >= 5) break;
    }
    const deckListCount = deckData?.variants?.length ?? (deckData ? 1 : 0);
    return {
      id: arch.id,
      name: arch.name,
      image_url: cardImage,
      icon_url: iconUrl,
      icon_bg: iconBg,
      representation_pct: arch.representation_pct,
      creators,
      deckListCount,
    };
  });
})();

export default function HomeClient({
  stats,
  recentMatches = [],
  currentSpotlight = null,
  showcaseTiles = [],
  cardCatalogTopCards = [],
  cardCatalogFeatured = null,
}: {
  stats: Array<{ label: string; value: string }>;
  recentMatches?: RecentMatch[];
  currentSpotlight?: CurrentSpotlight | null;
  showcaseTiles?: ResolvedDeckTile[];
  cardCatalogTopCards?: CardIndexEntry[];
  cardCatalogFeatured?: { card: CardIndexEntry; raw: RawCard } | null;
}) {
  const [deckList, setDeckList] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [profiledAt, setProfiledAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const profileAnchor = useRef<HTMLDivElement>(null);

  // After a sign-in bounce, restore whatever the user pasted before. The
  // stash is cleared on read, so a manual refresh won't keep restoring it.
  useEffect(() => {
    const restored = popDeckList();
    if (restored) setDeckList(restored);
  }, []);

  async function handleAnalyze() {
    if (!deckList.trim()) {
      setError("Paste your deck list first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed.");
      } else {
        setResult(data as AnalysisResult);
        setProfiledAt(new Date().toISOString());
        // Smooth-scroll the new profile into view.
        requestAnimationFrame(() => {
          profileAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-[2.1175rem] md:pt-14 pb-24 lg:pb-16 text-center lg:text-left">
        {/* No logo here on any breakpoint — desktop already shows it in
            the sidebar, mobile/tablet gets it from the sticky toolbar
            (MobileToolbarLogo, home added to its top-level route set). */}

        {/* Desktop (lg:+) splits into two equal-width, equal-height
            columns — heading/copy left-aligned on the left, the deck
            input card on the right. Mobile/tablet keep the original
            single-column, centered stack (no lg: classes apply). */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-stretch">
          <div className="lg:flex lg:flex-col lg:justify-start">
            <h2 className="text-[1.35rem] md:text-[2.7rem] font-semibold tracking-tight leading-[1.02] max-w-4xl mx-auto lg:mx-0">
              <span className="bg-gradient-brand bg-clip-text text-transparent">
                The deckbuilder&apos;s dex
              </span>
              <br />
              for Pokémon TCG.
            </h2>
            <p className="mt-6 text-sm md:text-xl font-semibold text-text-primary max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              Paste your list to create a Deck Profile.
              <br />
              Save to take notes and track performance.
            </p>

            {/* Desktop-only: the stats strip lives here, under the hero
                copy, so the two-column hero flows straight into Top Meta
                Archetypes below. Mobile/tablet keep it as its own
                section further down (hidden here via hidden lg:block). */}
            {!(result && profiledAt) && (
              <div className="hidden lg:block mt-10">
                <StatsStrip stats={stats} />
              </div>
            )}
          </div>

          {/* Deck input card — soft elevated glass on light bg. mx-auto is
              cancelled at lg: (via lg:mx-0) because auto margins on a
              flex item's cross axis opt it out of the default stretch
              behavior, which was leaving this narrower than the left
              column instead of filling it edge-to-edge. */}
          <div className="mt-12 lg:mt-0 max-w-3xl mx-auto lg:max-w-none lg:mx-0 lg:w-full lg:flex lg:flex-col lg:justify-start">
            <div className="relative group">
              {/* Gradient glow */}
              <div className="absolute -inset-px rounded-2xl bg-gradient-brand opacity-30 group-focus-within:opacity-70 blur-xl transition-opacity" />
              <div className="relative rounded-2xl bg-white/90 backdrop-blur-xl border border-black/5 p-2 shadow-brand-lg dark:bg-surface-elevated dark:border-white/10">
                <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
                  <span className="text-xs font-semibold text-text-primary">Deck List</span>
                  <button
                    onClick={() => setDeckList(EXAMPLE_DECK)}
                    className="text-xs text-text-muted hover:text-text-primary transition"
                  >
                    Load example
                  </button>
                </div>
                <textarea
                  value={deckList}
                  onChange={(e) => setDeckList(e.target.value)}
                  placeholder={"Pokémon: 13\n3 N's Zoroark ex JTG 175\n2 N's Reshiram ASC 154\n..."}
                  className="w-full h-36 md:h-48 bg-transparent resize-none px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted/60 outline-none"
                  spellCheck={false}
                />
                <div className="flex items-center justify-end gap-3 px-2 pb-2">
                  {deckList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDeckList("")}
                      className="text-xs text-text-muted hover:text-text-primary transition"
                    >
                      Clear
                    </button>
                  )}
                  <GradientButton onClick={handleAnalyze} disabled={loading}>
                    {loading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Profiling…
                      </>
                    ) : (
                      "Profile this deck"
                    )}
                  </GradientButton>
                </div>
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Anchor used to scroll the new profile into view after analysis. */}
      <div ref={profileAnchor} />

      {result && profiledAt ? (
        <DeckProfileView
          variant="fresh"
          deckList={deckList}
          analysis={result}
          profiledAt={profiledAt}
          subtitle={false}
        />
      ) : (
        <>
          {/* Stats strip — mobile/tablet only; desktop shows it inside the
              hero's left column instead (see above). Pulled up toward
              the hero above (Hero's own pb-24 is shared with the
              DeckProfileView path, so this section counteracts part of
              it with a negative top margin rather than shrinking Hero's
              padding directly) and given a shorter pb-4 (half of pb-8)
              so Top Meta Archetypes below sits closer still. */}
          <section className="lg:hidden mx-auto max-w-2xl px-4 sm:px-6 -mt-16 pb-6">
            <StatsStrip stats={stats} />
          </section>

          {/* Meta ticker */}
          <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
            <h2 className="text-3xl font-semibold tracking-tight mb-4">Top Meta Archetypes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {top3Cards.map((c) => (
                <MetaDeckCard
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  image_url={c.image_url}
                  icon_url={c.icon_url}
                  icon_bg={c.icon_bg}
                  representation_pct={c.representation_pct}
                  creators={c.creators}
                  deckListCount={c.deckListCount}
                />
              ))}
            </div>
            <div className="mt-6 flex justify-center">
              <Link href="/meta-archetypes" className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition dark:bg-white dark:text-black dark:hover:bg-white/85">
                View all
              </Link>
            </div>
          </section>

          {/* Secondary CTA */}
          <section className="mx-auto max-w-4xl px-4 sm:px-6 pb-24 text-center">
            <div className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-text-primary">
              A dex for your decks. Save your own lists, share with fellow trainers, and browse the top meta archetypes. Track your progress and earn badges.
            </div>
          </section>

          {/* Recent Matches */}
          {recentMatches.length > 0 && (
            <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
              <h2 className="text-3xl font-semibold tracking-tight mb-4">Recent Battles</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentMatches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
              <div className="mt-6 flex justify-center">
                <Link href="/matches" className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition dark:bg-white dark:text-black dark:hover:bg-white/85">
                  View all
                </Link>
              </div>
            </section>
          )}

          {/* Playmat Studio showcase */}
          <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
            <div className="mb-4">
              <h2 className="text-3xl font-semibold tracking-tight">Playmat Studio</h2>
            </div>
            <PlaymatShowcase tiles={showcaseTiles} />
          </section>

          {/* Trainer Spotlight preview */}
          {currentSpotlight && (
            <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
              <div className="mb-4">
                <h2 className="text-3xl font-semibold tracking-tight">Trainer Spotlight</h2>
              </div>
              <Link
                href={`/spotlight/${currentSpotlight.slug}`}
                className="block rounded-2xl overflow-hidden border border-black/8 shadow-sm hover:shadow-md transition-shadow dark:border-white/10"
              >
                <SpotlightBanner
                  accentColors={currentSpotlight.accentColors}
                  layout={currentSpotlight.layout}
                  editable={false}
                  spotlightId={currentSpotlight.id}
                  favoriteCollectionCards={currentSpotlight.favoriteCollectionCards}
                  favoriteFormatCards={currentSpotlight.favoriteFormatCards}
                  userImageUrl={currentSpotlight.userImageUrl}
                  className="relative w-full overflow-hidden aspect-[3/1]"
                />
              </Link>
              <div className="mt-10 max-w-4xl mx-auto text-center text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-text-primary">
                &ldquo;TCG is a cerebral game first and foremost and I want to find THE deck for me and help others along the way.&rdquo;
              </div>
              <div className="mt-4 text-center text-lg md:text-xl font-semibold tracking-tight">
                <span className="bg-gradient-brand bg-clip-text text-transparent">
                  @{currentSpotlight.username}
                </span>
              </div>
              <div className="mt-10 flex justify-center">
                <Link
                  href={`/spotlight/${currentSpotlight.slug}`}
                  className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition shadow-lg dark:bg-white dark:text-black dark:hover:bg-white/85"
                >
                  View Trainer Spotlight
                </Link>
              </div>
            </section>
          )}

          {/* Card Catalog preview */}
          {cardCatalogTopCards.length > 0 && (
            <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
              <InventoryProvider>
                <div className="mb-4">
                  <h2 className="text-3xl font-semibold tracking-tight">Card Catalog</h2>
                </div>
                <CatalogSignInBanner />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {cardCatalogTopCards.map((c, i) => (
                    <GridTile key={c.id} card={c} index={i} />
                  ))}
                </div>

                {cardCatalogFeatured && (
                  <div className="mt-12">
                    <CardDetailPanel
                      card={cardCatalogFeatured.card}
                      raw={cardCatalogFeatured.raw}
                    />
                    <div className="mt-6 flex justify-center">
                      <Link
                        href="/cards"
                        className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition dark:bg-white dark:text-black dark:hover:bg-white/85"
                      >
                        Browse All Cards
                      </Link>
                    </div>
                  </div>
                )}
              </InventoryProvider>
            </section>
          )}

          {/* Final CTA */}
          <section className="mx-auto max-w-5xl px-4 sm:px-6 pb-24">
            <div className="relative rounded-3xl overflow-hidden border border-black/8 shadow-xl dark:border-white/10">
              <div className="absolute inset-0 bg-gradient-brand opacity-20" />
              <div className="relative p-12 md:p-20 text-center">
                <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] max-w-3xl mx-auto text-text-primary">
                  Ready to see what your deck is really made of?
                </h2>
                <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href="/"
                    className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition shadow-lg dark:bg-white dark:text-black dark:hover:bg-white/85"
                  >
                    Profile a deck now
                  </Link>
                  <Link
                    href="/meta-archetypes"
                    className="rounded-full border border-black/15 bg-white/80 backdrop-blur-sm text-text-primary font-semibold px-6 py-3 hover:bg-white transition dark:bg-surface-elevated dark:border-white/10 dark:hover:bg-surface-elevated"
                  >
                    Browse the meta →
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Global search */}
          <section className="mx-auto max-w-xl px-4 sm:px-6 pb-32">
            <div className="relative group">
              <div className="absolute -inset-px rounded-full bg-gradient-brand opacity-30 group-focus-within:opacity-70 blur-xl transition-opacity" />
              <div className="relative">
                <UnifiedSearch placeholder="Search TCG Dexter" />
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

/** Signed-out CTA above the catalog preview grid — signed-in trainers see
 *  nothing here since their +/- controls on each tile already work.
 *  Renders inside InventoryProvider so it can read auth state. */
function CatalogSignInBanner() {
  const { signedIn, promptSignIn } = useInventory();
  if (signedIn !== false) return null;
  return (
    <button
      type="button"
      onClick={promptSignIn}
      className="mb-4 w-full rounded-2xl border border-black/8 bg-white/80 backdrop-blur-sm px-4 py-3 text-sm font-semibold text-text-primary hover:bg-white transition text-center dark:bg-surface-elevated dark:border-white/10 dark:hover:bg-surface-elevated"
    >
      Sign in to save cards to your collection
    </button>
  );
}
