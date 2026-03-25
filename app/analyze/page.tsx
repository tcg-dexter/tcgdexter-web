"use client";

import { useState } from "react";
import Link from "next/link";

/* ─── Types (mirrors API response) ───────────────────────────── */

interface Card {
  qty: number;
  name: string;
  section: "pokemon" | "trainer" | "energy";
}

interface EnergyProfile {
  primaryType: string | null;
  types: Record<string, number>;
  specialEnergy: string[];
  totalBasic: number;
  totalSpecial: number;
}

interface MatchupEntry {
  opponent: string;
  result: "Favorable" | "Even" | "Unfavorable";
  note: string;
}

interface Archetype {
  name: string;
  strategy: string;
  tier: number;
  style: "Aggro" | "Control" | "Combo" | "Stall" | "Midrange";
  winCondition: string;
  matchups: MatchupEntry[];
}

interface ConsistencyMetrics {
  drawSupporters: { name: string; qty: number }[];
  searchCards: { name: string; qty: number }[];
  totalDraw: number;
  totalSearch: number;
  rating: string;
}

interface AnalysisResult {
  deckSize: number;
  sections: { pokemon: number; trainer: number; energy: number };
  cards: Card[];
  energyProfile: EnergyProfile;
  archetype: Archetype | null;
  consistency: ConsistencyMetrics;
  warnings: string[];
}

/* ─── Energy type colors ─────────────────────────────────────── */

const ENERGY_COLORS: Record<string, string> = {
  Fire: "bg-red-500/20 text-red-400 border-red-500/30",
  Water: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Grass: "bg-green-500/20 text-green-400 border-green-500/30",
  Lightning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Psychic: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Fighting: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Darkness: "bg-zinc-600/30 text-zinc-300 border-zinc-500/30",
  Metal: "bg-slate-500/20 text-slate-300 border-slate-400/30",
  Fairy: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  Dragon: "bg-amber-600/20 text-amber-400 border-amber-500/30",
  Colorless: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

/* ─── Tier badge ─────────────────────────────────────────────── */

function TierBadge({ tier }: { tier: number }) {
  const styles: Record<number, string> = {
    1: "bg-energy/20 text-energy-light border-energy/30",
    2: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    3: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[tier] ?? styles[3]}`}
    >
      Tier {tier}
    </span>
  );
}

/* ─── Matchup badge ─────────────────────────────────────────── */

function MatchupBadge({ result }: { result: MatchupEntry["result"] }) {
  const styles: Record<string, string> = {
    Favorable: "bg-green-500/20 text-green-400 border-green-500/30",
    Even: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    Unfavorable: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[result]}`}
    >
      {result}
    </span>
  );
}

/* ─── Consistency rating color ───────────────────────────────── */

function ratingColor(rating: string): string {
  switch (rating) {
    case "Very High":
      return "text-green-400";
    case "High":
      return "text-emerald-400";
    case "Moderate":
      return "text-yellow-400";
    case "Low":
      return "text-orange-400";
    case "Very Low":
      return "text-red-400";
    default:
      return "text-slate-400";
  }
}

/* ─── Example deck list ──────────────────────────────────────── */

const EXAMPLE_DECK = `Pokémon: 15
3 Charizard ex OBF 125
1 Charizard ex TEF 54
4 Charmander OBF 26
1 Charmeleon OBF 27
2 Pidgeot ex OBF 164
2 Pidgey OBF 162
1 Rotom V CRZ 45
1 Lumineon V BRS 40

Trainer: 33
4 Arven OBF 186
4 Iono PAL 185
2 Boss's Orders PAL 172
2 Professor's Research SVI 189
4 Rare Candy SVI 191
4 Ultra Ball SVI 196
4 Nest Ball SVI 181
2 Super Rod PAL 188
2 Pal Pad SVI 182
1 Counter Catcher PAR 160
1 Lost Vacuum CRZ 135
1 Forest Seal Stone SIT 156
1 Choice Belt PAL 176
1 Collapsed Stadium BRS 137

Energy: 12
7 Basic Fire Energy SVE 2
3 Basic Fire Energy SVE 2
2 Double Turbo Energy BRS 151`;

/* ─── Page Component ─────────────────────────────────────────── */

export default function AnalyzePage() {
  const [deckList, setDeckList] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        setResult(data);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleLoadExample() {
    setDeckList(EXAMPLE_DECK);
    setResult(null);
    setError(null);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="flex-shrink-0 pt-12 pb-8 px-6 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors mb-6"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          Back to Dexter
        </Link>

        <div className="mx-auto mb-6 h-1 w-12 rounded-full bg-energy" />

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Deck Analyzer
        </h1>
        <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-md mx-auto leading-relaxed">
          Paste a PTCGL deck list and get an instant breakdown — energy profile,
          archetype, consistency, and more.
        </p>
      </header>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="flex-1 px-6 pb-20">
        <div className="mx-auto max-w-2xl flex flex-col gap-6">
          {/* Input section */}
          <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <label
                htmlFor="deck-input"
                className="text-sm font-medium text-slate-400"
              >
                Deck List
              </label>
              <button
                onClick={handleLoadExample}
                className="text-xs text-energy hover:text-energy-light transition-colors"
              >
                Load example
              </button>
            </div>

            <textarea
              id="deck-input"
              value={deckList}
              onChange={(e) => setDeckList(e.target.value)}
              placeholder={`Pokémon: 12\n4 Charizard ex OBF 125\n2 Charmander OBF 26\n...\n\nTrainer: 18\n4 Arven OBF 186\n...\n\nEnergy: 10\n10 Basic Fire Energy SVE 2`}
              rows={12}
              className="w-full rounded-lg border border-white/[0.06] bg-navy-900/60 px-4 py-3 text-sm font-mono text-white placeholder:text-slate-400/40 focus:outline-none focus:border-energy/40 focus:ring-1 focus:ring-energy/20 resize-y"
            />

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-energy px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-energy-light disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg
                      className="w-4 h-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Analyzing…
                  </>
                ) : (
                  "Analyze Deck"
                )}
              </button>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-4">
              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
                  <h3 className="text-sm font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                    <svg
                      className="w-4 h-4"
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
                      <li key={i} className="text-sm text-yellow-300/80">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Overview */}
              <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4">Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Total" value={result.deckSize} />
                  <Stat
                    label="Pokémon"
                    value={result.sections.pokemon}
                    color="text-blue-400"
                  />
                  <Stat
                    label="Trainers"
                    value={result.sections.trainer}
                    color="text-green-400"
                  />
                  <Stat
                    label="Energy"
                    value={result.sections.energy}
                    color="text-yellow-400"
                  />
                </div>

                {/* Composition bar */}
                <div className="mt-4 flex h-2.5 rounded-full overflow-hidden bg-navy-900/60">
                  {result.sections.pokemon > 0 && (
                    <div
                      className="bg-blue-500 transition-all"
                      style={{
                        width: `${(result.sections.pokemon / result.deckSize) * 100}%`,
                      }}
                    />
                  )}
                  {result.sections.trainer > 0 && (
                    <div
                      className="bg-green-500 transition-all"
                      style={{
                        width: `${(result.sections.trainer / result.deckSize) * 100}%`,
                      }}
                    />
                  )}
                  {result.sections.energy > 0 && (
                    <div
                      className="bg-yellow-500 transition-all"
                      style={{
                        width: `${(result.sections.energy / result.deckSize) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Pokémon
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Trainers
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    Energy
                  </span>
                </div>
              </div>

              {/* Archetype */}
              {result.archetype && (
                <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
                  <h2 className="text-lg font-semibold mb-3">Archetype</h2>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl font-bold text-energy-light">
                      {result.archetype.name}
                    </span>
                    <TierBadge tier={result.archetype.tier} />
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-slate-500/20 text-slate-300 border-slate-500/30">
                      {result.archetype.style}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {result.archetype.strategy}
                  </p>
                  <div className="mt-3">
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                      Win Condition
                    </p>
                    <p className="text-sm text-slate-200 leading-relaxed">
                      {result.archetype.winCondition}
                    </p>
                  </div>
                </div>
              )}

              {/* Energy Profile */}
              <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-3">Energy Profile</h2>

                {result.energyProfile.primaryType && (
                  <p className="text-sm text-slate-400 mb-4">
                    Primary type:{" "}
                    <span className="font-semibold text-white">
                      {result.energyProfile.primaryType}
                    </span>
                  </p>
                )}

                {Object.keys(result.energyProfile.types).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {Object.entries(result.energyProfile.types).map(
                      ([type, count]) => (
                        <span
                          key={type}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${ENERGY_COLORS[type] ?? "bg-white/5 text-white border-white/10"}`}
                        >
                          {type}
                          <span className="text-xs opacity-70">&times;{count}</span>
                        </span>
                      )
                    )}
                  </div>
                )}

                {result.energyProfile.specialEnergy.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Special Energy
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.energyProfile.specialEnergy.map((se, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white"
                        >
                          {se}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Consistency */}
              <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Consistency</h2>
                  <span
                    className={`text-sm font-semibold ${ratingColor(result.consistency.rating)}`}
                  >
                    {result.consistency.rating}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Draw */}
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Draw Supporters ({result.consistency.totalDraw})
                    </p>
                    {result.consistency.drawSupporters.length > 0 ? (
                      <ul className="space-y-1">
                        {result.consistency.drawSupporters.map((d, i) => (
                          <li
                            key={i}
                            className="text-sm flex justify-between"
                          >
                            <span className="text-white">{d.name}</span>
                            <span className="text-slate-400">
                              &times;{d.qty}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400/60">
                        None detected
                      </p>
                    )}
                  </div>

                  {/* Search */}
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Search Cards ({result.consistency.totalSearch})
                    </p>
                    {result.consistency.searchCards.length > 0 ? (
                      <ul className="space-y-1">
                        {result.consistency.searchCards.map((s, i) => (
                          <li
                            key={i}
                            className="text-sm flex justify-between"
                          >
                            <span className="text-white">{s.name}</span>
                            <span className="text-slate-400">
                              &times;{s.qty}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400/60">
                        None detected
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Matchup Guide */}
              {result.archetype?.matchups && result.archetype.matchups.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-navy-800/80 p-5 backdrop-blur-sm">
                  <h2 className="text-lg font-semibold">Matchup Guide</h2>
                  <p className="text-xs text-slate-400 mb-4">vs current top meta</p>
                  <div className="divide-y divide-white/[0.06]">
                    {result.archetype.matchups.map((m, i) => (
                      <div key={i} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{m.opponent}</span>
                          <MatchupBadge result={m.result} />
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{m.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="flex-shrink-0 py-8 text-center text-sm text-slate-400/60">
        &copy; 2026 Dexter&apos;s Collection &middot; tcgdexter.com
      </footer>
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────────── */

function Stat({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}
