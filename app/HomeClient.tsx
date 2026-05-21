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
import { getTierByTitle } from "@/lib/trainer-tiers";
import type { TopTrainer } from "@/app/page";

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
// /meta-decks: pick the face Pokémon card from each archetype's deck list,
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

const rankMedal = ["🥇", "🥈", "🥉"];

export default function HomeClient({
  stats,
  topTrainers,
}: {
  stats: Array<{ label: string; value: string }>;
  topTrainers: TopTrainer[];
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
                <h2 className="text-4xl font-semibold tracking-tight">This week&apos;s top archetypes.</h2>
              </div>
              <Link
                href="/meta-decks"
                className="text-sm text-text-secondary hover:text-text-primary transition self-start md:self-auto whitespace-nowrap"
              >
                View Top 30 Meta Decks →
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

          {/* Top Trainers — hidden from UI; keep block for future re-enable */}
          {false && (
          <section className="mx-auto max-w-2xl px-6 py-6">
            <div className="mb-6">
              <div className="text-xs uppercase tracking-widest text-accent mb-3 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#ff8a3d] opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff8a3d]" />
                </span>
                Live leaderboard
              </div>
              <h2 className="text-4xl font-semibold tracking-tight">Top Trainers</h2>
            </div>

            {topTrainers.length > 0 && (
              <div className="rounded-xl border border-black/8 bg-white shadow-sm overflow-hidden">
                {topTrainers.map((trainer, i) => {
                  const tier = getTierByTitle(trainer.trainer_title ?? "Rookie Trainer");
                  return (
                    <Link
                      key={trainer.id}
                      href={`/u/${trainer.username}`}
                      className="flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02] transition border-b border-black/5 last:border-b-0"
                    >
                      <span className="text-xl w-7 flex-shrink-0">{rankMedal[i]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-text-primary truncate">{trainer.display_name}</div>
                      </div>
                      <div className={`hidden sm:flex text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${tier.color} ${tier.borderColor} ${tier.bgColor}`}>
                        {tier.title}
                      </div>
                      <div className="text-xs text-text-muted flex-shrink-0">
                        <span className="font-semibold tabular-nums text-text-primary">{trainer.totalLikes}</span> likes
                        {" · "}
                        <span className="font-semibold tabular-nums text-text-primary">{trainer.deckCount}</span> decks
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
          )}

          {/* Secondary CTA */}
          <section className="mx-auto max-w-4xl px-6 py-24 text-center">
            <div className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight text-text-primary">
              A dex for your decks. Save your own lists, share with fellow trainers, and browse the top meta archetypes. Track your progress and earn badges.
            </div>
          </section>

          {/* Final CTA */}
          <section className="mx-auto max-w-5xl px-6 pb-32">
            <div className="relative rounded-3xl overflow-hidden border border-black/8 shadow-xl">
              <div className="absolute inset-0 bg-gradient-brand opacity-20" />
              <div className="relative p-12 md:p-20 text-center">
                <h2 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl mx-auto text-text-primary">
                  Ready to see what your deck is really made of?
                </h2>
                <p className="mt-6 text-lg text-text-secondary max-w-xl mx-auto">
                  Free forever for your first 10 profiles. No card, no catch, no email spam.
                </p>
                <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href="/"
                    className="rounded-full bg-black text-white font-semibold px-6 py-3 hover:bg-black/85 transition shadow-lg"
                  >
                    Profile a deck now
                  </Link>
                  <Link
                    href="/meta-decks"
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
