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
import { shade } from "@/lib/color";
import SpotlightBanner from "@/app/spotlight/components/SpotlightBanner";
import type {
  SpotlightBannerLayout,
  SpotlightCardRef,
  SpotlightPokemonRef,
} from "@/app/spotlight/types";

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

export type RecentMatch = {
  id: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  opponentHandle: string | null;
  createdAt: string;
  deckId: string;
  deckName: string;
  username: string;
  deckImageUrl: string | null;
  opponentImageUrl: string | null;
  opponentAttackerName: string | null;
  playerColor: string;
  opponentColor: string;
  /** Prize cards taken in this match. Sourced from match_actions
   *  prize_taken rows; 0 when the battle log has no prize events. */
  playerPrizes: number;
  opponentPrizes: number;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MatchCard({ match }: { match: RecentMatch }) {
  const opponentDeckLabel =
    match.opponentArchetype ?? match.opponentAttackerName ?? "Unknown deck";
  const opponentHandleLabel = match.opponentHandle ?? "Opponent";

  // This section is identity-agnostic: winner card always renders on the
  // left, loser on the right. On a draw, fall back to the site-standard
  // gradient and keep the natural player/opponent order.
  const isDraw = match.result === "draw";
  const playerWon = match.result === "win";
  const leftSide = playerWon
    ? {
        imageUrl: match.deckImageUrl,
        imageAlt: match.deckName,
        handleLabel: match.username,
        deckLabel: match.deckName,
        color: match.playerColor,
        prizes: match.playerPrizes,
      }
    : {
        imageUrl: match.opponentImageUrl,
        imageAlt: match.opponentAttackerName ?? "Opponent",
        handleLabel: opponentHandleLabel,
        deckLabel: opponentDeckLabel,
        color: match.opponentColor,
        prizes: match.opponentPrizes,
      };
  const rightSide = playerWon
    ? {
        imageUrl: match.opponentImageUrl,
        imageAlt: match.opponentAttackerName ?? "Opponent",
        handleLabel: opponentHandleLabel,
        deckLabel: opponentDeckLabel,
        color: match.opponentColor,
        prizes: match.opponentPrizes,
      }
    : {
        imageUrl: match.deckImageUrl,
        imageAlt: match.deckName,
        handleLabel: match.username,
        deckLabel: match.deckName,
        color: match.playerColor,
        prizes: match.playerPrizes,
      };

  const gradientStyle: React.CSSProperties | undefined = isDraw
    ? undefined
    : {
        background:
          leftSide.color === rightSide.color
            ? `linear-gradient(90deg, ${leftSide.color} 0%, ${shade(leftSide.color, -18)} 100%)`
            : `linear-gradient(90deg, ${leftSide.color} 0%, ${rightSide.color} 100%)`,
      };
  const gradientClass = isDraw
    ? "absolute inset-0 bg-gradient-brand opacity-80"
    : "absolute inset-0 opacity-80";

  const footer = (
    <div className="grid grid-cols-2 gap-3 px-3.5 pt-3 pb-3.5 border-t border-black/[0.06]">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-text-muted truncate">
          {leftSide.handleLabel}&rsquo;s
        </p>
        <p className="text-[13px] font-semibold text-text-primary truncate">
          {leftSide.deckLabel}
        </p>
      </div>
      <div className="min-w-0 text-right">
        <p className="text-[11px] font-medium text-text-muted truncate">
          {rightSide.handleLabel}&rsquo;s
        </p>
        <p className="text-[13px] font-semibold text-text-primary truncate">
          {rightSide.deckLabel}
        </p>
      </div>
    </div>
  );

  // Versus layout — battle log match with both card images
  if (leftSide.imageUrl && rightSide.imageUrl) {
    return (
      <Link
        href={`/battles/${match.id}`}
        className="block rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="relative">
          <div className={gradientClass} style={gradientStyle} />
          {/* Prize counts — large white digits flanking the card pair,
              vertically centered within the gradient zone. Use absolute
              positioning so the centered cards stay perfectly centered
              regardless of digit width. */}
          <span
            aria-label={`${leftSide.handleLabel} prizes taken`}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-white text-5xl font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
          >
            {leftSide.prizes}
          </span>
          <span
            aria-label={`${rightSide.handleLabel} prizes taken`}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-white text-5xl font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
          >
            {rightSide.prizes}
          </span>
          <div className="relative flex items-end justify-center gap-8 px-4 pt-5 pb-3">
            <div style={{ transform: "rotate(-6deg)", transformOrigin: "bottom center" }}>
              <div className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]" style={{ width: 80, height: 112 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={leftSide.imageUrl} alt={leftSide.imageAlt} className="w-full h-full object-contain" />
              </div>
            </div>
            <div style={{ transform: "rotate(6deg)", transformOrigin: "bottom center" }}>
              <div className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]" style={{ width: 80, height: 112 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rightSide.imageUrl} alt={rightSide.imageAlt} className="w-full h-full object-contain" />
              </div>
            </div>
          </div>
          <div className="relative px-3.5 pb-2 flex items-center justify-end gap-2">
            <p className="text-[11px] text-white/80">{relativeTime(match.createdAt)}</p>
          </div>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-black text-white/90 tracking-[0.2em]">
            VS
          </span>
        </div>
        {footer}
      </Link>
    );
  }

  // Simple layout — leading image (whichever side has one) + info
  const leadImage = leftSide.imageUrl
    ? { url: leftSide.imageUrl, alt: leftSide.imageAlt }
    : rightSide.imageUrl
    ? { url: rightSide.imageUrl, alt: rightSide.imageAlt }
    : null;
  return (
    <Link
      href={`/battles/${match.id}`}
      className="block rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="relative flex gap-3.5 p-3.5">
        <div className={gradientClass} style={gradientStyle} />
        {leadImage && (
          <div
            className="relative shrink-0 rounded-lg overflow-hidden border border-black/[0.07] bg-[var(--surface)]"
            style={{ width: 72, height: 101 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={leadImage.url} alt={leadImage.alt} className="w-full h-full object-contain" />
          </div>
        )}
        <div className="relative flex-1 min-w-0 flex items-center justify-end gap-2">
          <p className="text-[11px] text-white/80">{relativeTime(match.createdAt)}</p>
        </div>
      </div>
      {footer}
    </Link>
  );
}

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
    return {
      id: arch.id,
      name: arch.name,
      image_url: cardImage,
      icon_url: iconUrl,
      icon_bg: iconBg,
      representation_pct: arch.representation_pct,
      creators,
    };
  });
})();

export default function HomeClient({
  stats,
  recentMatches = [],
  currentSpotlight = null,
}: {
  stats: Array<{ label: string; value: string }>;
  recentMatches?: RecentMatch[];
  currentSpotlight?: CurrentSpotlight | null;
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
      <section className="mx-auto max-w-6xl px-6 pt-[1.925rem] md:pt-14 pb-16 text-center">
        {/* Logo */}
        <div className="flex justify-center mb-7 md:mb-8">
          <img
            src="/logo-light.png"
            alt="TCG Dexter"
            className="max-w-full"
            style={{ width: "240px", height: "auto" }}
          />
        </div>

        <h1 className="text-3xl md:text-7xl font-semibold tracking-tight leading-[1.02] max-w-4xl mx-auto">
          The deckbuilder&apos;s
          <br />
          <span className="bg-gradient-brand bg-clip-text text-transparent">
            dex for Pokémon TCG.
          </span>
        </h1>
        <p className="mt-6 text-sm md:text-xl font-semibold text-text-primary max-w-2xl mx-auto leading-relaxed">
          Paste your list to create a Deck Profile.
          <br />
          Save to take notes and track performance.
        </p>

        {/* Deck input card — soft elevated glass on light bg */}
        <div className="mt-12 max-w-3xl mx-auto">
          <div className="relative group">
            {/* Gradient glow */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-brand opacity-30 group-focus-within:opacity-70 blur-xl transition-opacity" />
            <div className="relative rounded-2xl bg-white/90 backdrop-blur-xl border border-black/5 p-2 shadow-brand-lg">
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
                className="w-full h-48 bg-transparent resize-none px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted/60 outline-none"
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
          {/* Stats strip */}
          <section className="mx-auto max-w-2xl px-6 pb-24">
            <StatsStrip stats={stats} />
          </section>

          {/* Meta ticker */}
          <section className="mx-auto max-w-6xl px-6 py-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
              <div>
                <div className="text-xs uppercase tracking-widest text-accent mb-3 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-[#ff8a3d] opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff8a3d]" />
                  </span>
                  Live meta
                </div>
                <h2 className="text-4xl font-semibold tracking-tight">Top Meta Archetypes</h2>
              </div>
              <Link
                href="/meta-archetypes"
                className="text-sm text-text-secondary hover:text-text-primary transition self-start md:self-auto whitespace-nowrap"
              >
                View all →
              </Link>
            </div>
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
                />
              ))}
            </div>
          </section>

          {/* Secondary CTA */}
          <section className="mx-auto max-w-4xl px-6 py-24 text-center">
            <div className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-text-primary">
              A dex for your decks. Save your own lists, share with fellow trainers, and browse the top meta archetypes. Track your progress and earn badges.
            </div>
          </section>

          {/* Recent Matches */}
          {recentMatches.length > 0 && (
            <section className="mx-auto max-w-6xl px-6 pb-16">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
                <div>
                  <h2 className="text-4xl font-semibold tracking-tight">Recent Battles</h2>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentMatches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}

          {/* Trainer Spotlight preview */}
          {currentSpotlight && (
            <section className="mx-auto max-w-6xl px-6 pb-24">
              <div className="mb-8">
                <h2 className="text-4xl font-semibold tracking-tight">Trainer Spotlight</h2>
              </div>
              <Link
                href={`/spotlight/${currentSpotlight.slug}`}
                className="block rounded-2xl overflow-hidden border border-black/8 shadow-sm hover:shadow-md transition-shadow"
              >
                <SpotlightBanner
                  accentColors={currentSpotlight.accentColors}
                  layout={currentSpotlight.layout}
                  editable={false}
                  spotlightId={currentSpotlight.id}
                  favoritePokemon={currentSpotlight.favoritePokemon}
                  favoriteCollectionCards={currentSpotlight.favoriteCollectionCards}
                  favoriteFormatCards={currentSpotlight.favoriteFormatCards}
                  userImageUrl={currentSpotlight.userImageUrl}
                  className="relative w-full overflow-hidden aspect-[3/1]"
                />
              </Link>
              <div className="mt-10 max-w-4xl mx-auto text-center text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-text-primary">
                &ldquo;Having just started playing at local tournaments at the end of last year, I put a lot of focus on one deck at a time, making small iterations after each batch of matchups.&rdquo;
              </div>
              <div className="mt-4 text-center text-lg md:text-xl font-semibold tracking-tight">
                <span className="bg-gradient-brand bg-clip-text text-transparent">
                  @{currentSpotlight.username}
                </span>
              </div>
              <div className="mt-10 flex justify-center">
                <Link
                  href={`/spotlight/${currentSpotlight.slug}`}
                  className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition shadow-lg"
                >
                  View Trainer Spotlight
                </Link>
              </div>
            </section>
          )}

          {/* Final CTA */}
          <section className="mx-auto max-w-5xl px-6 pb-32">
            <div className="relative rounded-3xl overflow-hidden border border-black/8 shadow-xl">
              <div className="absolute inset-0 bg-gradient-brand opacity-20" />
              <div className="relative p-12 md:p-20 text-center">
                <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl mx-auto text-text-primary">
                  Ready to see what your deck is really made of?
                </h2>
                <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href="/"
                    className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition shadow-lg"
                  >
                    Profile a deck now
                  </Link>
                  <Link
                    href="/meta-archetypes"
                    className="rounded-full border border-black/15 bg-white/80 backdrop-blur-sm text-text-primary font-semibold px-6 py-3 hover:bg-white transition"
                  >
                    Browse the meta →
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
