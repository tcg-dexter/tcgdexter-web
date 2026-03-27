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

interface RotatingCard {
  name: string;
  qty: number;
  regulationMark: string | null;
}

interface AttackerMismatch {
  cardName: string;
  attackName: string;
  cost: string[];
  missingTypes: string[];
}

interface HPCurveEntry {
  range: string;
  count: number;
}

interface AnalysisResult {
  deckSize: number;
  sections: { pokemon: number; trainer: number; energy: number };
  cards: Card[];
  energyProfile: EnergyProfile;
  archetype: Archetype | null;
  warnings: string[];
  rotatingCards: RotatingCard[];
  rotatingCount: number;
  rotationSafeCount: number;
  attackerMismatches: AttackerMismatch[];
  hpCurve: HPCurveEntry[];
  totalRetreatCost: number;
  switchCards: number;
  retreatBurdenRating: "Low" | "Moderate" | "High";
  abilityPokemon: number;
  attackOnlyPokemon: number;
  abilityRatio: number;
  dexterScore: number;
  scoreBreakdown: {
    archetype: number;
    rotation: number;
    energy: number;
    retreat: number;
    deckSize: number;
  };
}

/* ─── Energy type colors ─────────────────────────────────────── */

const ENERGY_COLORS: Record<string, string> = {
  Fire: "bg-red-100 text-red-700 border-red-200",
  Water: "bg-blue-100 text-blue-700 border-blue-200",
  Grass: "bg-green-100 text-green-700 border-green-200",
  Lightning: "bg-yellow-100 text-yellow-700 border-yellow-200",
  Psychic: "bg-purple-100 text-purple-700 border-purple-200",
  Fighting: "bg-orange-100 text-orange-700 border-orange-200",
  Darkness: "bg-stone-200 text-stone-700 border-stone-300",
  Metal: "bg-slate-100 text-slate-600 border-slate-200",
  Fairy: "bg-pink-100 text-pink-700 border-pink-200",
  Dragon: "bg-amber-100 text-amber-700 border-amber-200",
  Colorless: "bg-gray-100 text-gray-600 border-gray-200",
};

/* ─── Tier badge ─────────────────────────────────────────────── */

function TierBadge({ tier }: { tier: number }) {
  const styles: Record<number, string> = {
    1: "bg-red-100 text-red-700 border-red-200",
    2: "bg-blue-100 text-blue-700 border-blue-200",
    3: "bg-stone-100 text-stone-600 border-stone-200",
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
    Favorable: "bg-green-100 text-green-800 border-green-200",
    Even: "bg-amber-100 text-amber-800 border-amber-200",
    Unfavorable: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[result]}`}
    >
      {result}
    </span>
  );
}

/* ─── Dexter Score display ───────────────────────────────────── */

function dexterScoreColor(score: number): string {
  if (score >= 71) return "text-green-600";
  if (score >= 41) return "text-amber-600";
  return "text-red-600";
}

function dexterScoreBgColor(score: number): string {
  if (score >= 71) return "border-green-200 bg-green-50";
  if (score >= 41) return "border-amber-200 bg-amber-50";
  return "border-red-200 bg-red-50";
}

function dexterScoreLabel(score: number): string {
  if (score >= 80) return "Tournament Ready";
  if (score >= 71) return "Competitive";
  if (score >= 55) return "Solid Build";
  if (score >= 41) return "Needs Work";
  if (score >= 25) return "Casual";
  return "Not Competitive";
}

function ScoreBreakdownPill({
  label,
  score,
  max,
}: {
  label: string;
  score: number;
  max: number;
}) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  const barColor =
    pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400";

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex justify-between items-center">
        <span className="text-xs text-brown-500 truncate">{label}</span>
        <span className="text-xs font-semibold text-brown-900 ml-2 shrink-0">
          {score}/{max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-tan-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
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

export default function DeckProfilerPage() {
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
          className="inline-flex items-center gap-2 text-brown-500 hover:text-brown-900 text-sm transition-colors mb-6"
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
          Deck Profiler
        </h1>
        <p className="mt-3 text-sm sm:text-base text-brown-500 max-w-md mx-auto leading-relaxed">
          Paste your TCG Live deck list below and get an instant breakdown — Dexter Score, rotation check, energy coverage, HP curve, and more.
        </p>
      </header>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="flex-1 px-6 pb-20">
        <div className="mx-auto max-w-2xl flex flex-col gap-6">
          {/* Input section */}
          <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <label
                htmlFor="deck-input"
                className="text-sm font-medium text-brown-500"
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
              className="w-full rounded-lg border border-tan-200 bg-tan-50 px-4 py-3 text-sm font-mono text-brown-900 placeholder:text-brown-300 focus:outline-none focus:border-energy/40 focus:ring-1 focus:ring-energy/20 resize-y"
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
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-4">

              {/* ── Dexter Score ────────────────────────────── */}
              <div
                className={`rounded-xl border p-5 backdrop-blur-sm ${dexterScoreBgColor(result.dexterScore)}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs text-brown-500 uppercase tracking-wide mb-0.5">
                      Competitive Rating
                    </p>
                    <p className="text-xs text-brown-400">Dexter Score</p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-5xl font-black leading-none ${dexterScoreColor(result.dexterScore)}`}
                    >
                      {result.dexterScore}
                    </p>
                    <p className="text-xs text-brown-400 mt-1">out of 100</p>
                  </div>
                </div>

                <p
                  className={`text-sm font-semibold mb-4 ${dexterScoreColor(result.dexterScore)}`}
                >
                  {dexterScoreLabel(result.dexterScore)}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <ScoreBreakdownPill
                    label="Archetype"
                    score={result.scoreBreakdown.archetype}
                    max={30}
                  />
                  <ScoreBreakdownPill
                    label="Rotation"
                    score={result.scoreBreakdown.rotation}
                    max={20}
                  />
                  <ScoreBreakdownPill
                    label="Energy"
                    score={result.scoreBreakdown.energy}
                    max={20}
                  />
                  <ScoreBreakdownPill
                    label="Retreat"
                    score={result.scoreBreakdown.retreat}
                    max={15}
                  />
                  <ScoreBreakdownPill
                    label="Deck Size"
                    score={result.scoreBreakdown.deckSize}
                    max={15}
                  />
                </div>
              </div>

              {/* ── Warnings ────────────────────────────────── */}
              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-600/30 bg-amber-50 p-4">
                  <h3 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-2">
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
                      <li key={i} className="text-sm text-amber-700">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── Overview ────────────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4">Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Total" value={result.deckSize} />
                  <Stat
                    label="Pokémon"
                    value={result.sections.pokemon}
                    color="text-blue-600"
                  />
                  <Stat
                    label="Trainers"
                    value={result.sections.trainer}
                    color="text-green-600"
                  />
                  <Stat
                    label="Energy"
                    value={result.sections.energy}
                    color="text-yellow-600"
                  />
                </div>

                <div className="mt-4 flex h-2.5 rounded-full overflow-hidden bg-tan-200">
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
                <div className="mt-2 flex justify-between text-xs text-brown-500">
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

              {/* ── Archetype ───────────────────────────────── */}
              {result.archetype && (
                <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                  <h2 className="text-lg font-semibold mb-3">Archetype</h2>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl font-bold text-energy">
                      {result.archetype.name}
                    </span>
                    <TierBadge tier={result.archetype.tier} />
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-tan-200 text-brown-700 border-tan-300">
                      {result.archetype.style}
                    </span>
                  </div>
                  <p className="text-sm text-brown-500 leading-relaxed">
                    {result.archetype.strategy}
                  </p>
                  <div className="mt-3">
                    <p className="text-xs text-brown-500 uppercase tracking-wide mb-1">
                      Win Condition
                    </p>
                    <p className="text-sm text-brown-700 leading-relaxed">
                      {result.archetype.winCondition}
                    </p>
                  </div>
                </div>
              )}

              {/* ── Energy Profile ───────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-3">Energy Profile</h2>

                {result.energyProfile.primaryType && (
                  <p className="text-sm text-brown-500 mb-4">
                    Primary type:{" "}
                    <span className="font-semibold text-brown-900">
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
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${ENERGY_COLORS[type] ?? "bg-tan-50 text-brown-900 border-tan-200"}`}
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
                    <p className="text-xs text-brown-500 uppercase tracking-wide mb-2">
                      Special Energy
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.energyProfile.specialEnergy.map((se, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded-full border border-tan-200 bg-tan-50 px-3 py-1 text-sm text-brown-900"
                        >
                          {se}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Rotation Warning ─────────────────────────── */}
              {result.rotatingCards.length > 0 ? (
                <div className="rounded-xl border border-amber-600/30 bg-amber-50 p-5">
                  <h2 className="text-lg font-semibold text-amber-900 mb-1 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                    Rotation Warning
                  </h2>
                  <p className="text-sm text-amber-700 mb-3">
                    {result.rotatingCount} card{result.rotatingCount !== 1 ? "s" : ""} rotating April 10, 2026
                  </p>
                  <div className="space-y-1">
                    {result.rotatingCards.map((card, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-amber-900 font-medium">{card.name}</span>
                        <div className="flex items-center gap-3">
                          {card.regulationMark && (
                            <span className="text-xs text-amber-600 bg-amber-100 rounded px-1.5 py-0.5 font-mono">
                              {card.regulationMark}
                            </span>
                          )}
                          <span className="text-amber-700">&times;{card.qty}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold">Rotation Ready ✓</span>
                  </div>
                  <p className="text-xs text-green-700 mt-1 ml-7">All cards legal after April 10, 2026</p>
                </div>
              )}

              {/* ── Attack Coverage ──────────────────────────── */}
              {result.attackerMismatches.length > 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                  <h2 className="text-lg font-semibold text-red-900 mb-1">Attack Coverage</h2>
                  <p className="text-sm text-red-700 mb-3">
                    {result.attackerMismatches.length} attack{result.attackerMismatches.length !== 1 ? "s" : ""} may lack required energy types
                  </p>
                  <div className="space-y-2">
                    {result.attackerMismatches.map((m, i) => (
                      <div key={i} className="rounded-lg bg-red-100 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-sm font-medium text-red-900">{m.cardName}</span>
                            <span className="text-xs text-red-600 ml-2">— {m.attackName}</span>
                          </div>
                        </div>
                        <p className="text-xs text-red-700 mt-0.5">
                          Missing: {m.missingTypes.join(", ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-semibold">Energy matches all attackers ✓</span>
                  </div>
                  <p className="text-xs text-green-700 mt-1 ml-7">All attack costs are covered by your energy types</p>
                </div>
              )}

              {/* ── HP Curve ─────────────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4">HP Curve</h2>
                {(() => {
                  const maxCount = Math.max(...result.hpCurve.map((b) => b.count), 1);
                  return (
                    <div className="space-y-2">
                      {result.hpCurve.map((bucket) => (
                        <div key={bucket.range} className="flex items-center gap-3">
                          <span className="text-xs text-brown-500 w-16 shrink-0 font-mono">
                            {bucket.range}
                          </span>
                          <div className="flex-1 h-6 rounded bg-tan-200 overflow-hidden">
                            <div
                              className="h-full rounded bg-blue-400 transition-all"
                              style={{
                                width: `${bucket.count > 0 ? Math.max((bucket.count / maxCount) * 100, 4) : 0}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-brown-700 w-6 text-right shrink-0">
                            {bucket.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <p className="text-xs text-brown-400 mt-3">HP ranges for Pokémon in your deck (by unique lines)</p>
              </div>

              {/* ── Retreat Burden ───────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">Retreat Burden</h2>
                  <span
                    className={`text-sm font-semibold px-2.5 py-0.5 rounded-full border text-xs ${
                      result.retreatBurdenRating === "Low"
                        ? "bg-green-100 text-green-700 border-green-200"
                        : result.retreatBurdenRating === "Moderate"
                        ? "bg-amber-100 text-amber-700 border-amber-200"
                        : "bg-red-100 text-red-700 border-red-200"
                    }`}
                  >
                    {result.retreatBurdenRating}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-brown-900">
                      {result.totalRetreatCost}
                    </p>
                    <p className="text-xs text-brown-500 mt-0.5">Total Retreat Cost</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-brown-900">
                      {result.switchCards}
                    </p>
                    <p className="text-xs text-brown-500 mt-0.5">Switch Cards</p>
                  </div>
                </div>
                {result.retreatBurdenRating === "High" && (
                  <p className="text-xs text-red-600 mt-3">
                    ⚠️ High retreat burden — consider adding more Switch, Escape Rope, or Jet Energy.
                  </p>
                )}
              </div>

              {/* ── Ability Density ──────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-3">Ability Density</h2>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">
                      {result.abilityPokemon}
                    </p>
                    <p className="text-xs text-brown-500 mt-0.5">With Abilities</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-brown-700">
                      {result.attackOnlyPokemon}
                    </p>
                    <p className="text-xs text-brown-500 mt-0.5">Attack-Only</p>
                  </div>
                </div>
                {/* Ratio bar */}
                {(result.abilityPokemon + result.attackOnlyPokemon) > 0 && (
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-tan-200 mb-2">
                    <div
                      className="bg-purple-400 transition-all"
                      style={{ width: `${result.abilityRatio * 100}%` }}
                    />
                    <div className="bg-tan-300 flex-1" />
                  </div>
                )}
                <p className="text-xs text-brown-500">
                  {Math.round(result.abilityRatio * 100)}% of unique Pokémon lines have abilities
                  {result.abilityRatio < 0.2 && (
                    <span className="text-amber-600 ml-1">— may be vulnerable to ability-lock strategies</span>
                  )}
                  {result.abilityRatio > 0.8 && (
                    <span className="text-purple-600 ml-1">— heavy ability reliance, watch for Canceling Cologne</span>
                  )}
                </p>
              </div>

              {/* ── Matchup Guide ────────────────────────────── */}
              {result.archetype?.matchups && result.archetype.matchups.length > 0 && (
                <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                  <h2 className="text-lg font-semibold">Matchup Guide</h2>
                  <p className="text-xs text-brown-500 mb-4">vs current top meta</p>
                  <div className="divide-y divide-tan-200">
                    {result.archetype.matchups.map((m, i) => (
                      <div key={i} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-brown-900">{m.opponent}</span>
                          <MatchupBadge result={m.result} />
                        </div>
                        <p className="text-xs text-brown-500 mt-1">{m.note}</p>
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
      <footer className="flex-shrink-0 py-8 px-6 text-center text-sm text-brown-300">
        <p>&copy; 2026 TCG Dexter &middot; tcgdexter.com</p>
        <p className="mt-3 max-w-lg mx-auto text-xs text-brown-300/70 leading-relaxed">
          TCG Dexter is an independent organization. The information presented on this website about the Pokémon Trading Card Game, including images and text, is intellectual property of The Pokémon Company, Nintendo, Game Freak, Creatures and/or Wizards of the Coast. TCG Dexter is not produced by, endorsed by, supported by, or affiliated with any of these companies.
        </p>
      </footer>
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────────── */

function Stat({
  label,
  value,
  color = "text-brown-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-brown-500 mt-0.5">{label}</p>
    </div>
  );
}
