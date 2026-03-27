"use client";

import { useState } from "react";
import Link from "next/link";

/* ─── Types (mirrors API response) ───────────────────────────── */

interface Card {
  qty: number;
  name: string;
  section: "pokemon" | "trainer" | "energy";
}

interface PokemonAbility {
  pokemonName: string;
  abilityName: string;
  description: string;
}

interface PokemonAttack {
  pokemonName: string;
  attackName: string;
  cost: string[];
  damage: string;
  description: string;
}

interface AnalysisResult {
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
    abilities: PokemonAbility[];
    attacks: PokemonAttack[];
  };
  metaMatch: {
    matched: boolean;
    archetypeName: string | null;
    matchPct: number | null;
  };
  cards: Card[];
  warnings: string[];
}

/* ─── Energy type colors ─────────────────────────────────────── */

const ENERGY_COLORS: Record<string, string> = {
  Fire:      "bg-red-100 text-black border-red-200",
  Water:     "bg-blue-100 text-black border-blue-200",
  Grass:     "bg-green-100 text-black border-green-200",
  Lightning: "bg-yellow-100 text-black border-yellow-200",
  Psychic:   "bg-violet-100 text-black border-violet-200",
  Fighting:  "bg-amber-100 text-black border-amber-200",
  Darkness:  "bg-teal-200 text-black border-teal-400",
  Metal:     "bg-zinc-100 text-black border-zinc-200",
  Fairy:     "bg-pink-100 text-black border-pink-200",
  Dragon:    "bg-amber-100 text-black border-amber-200",
  Colorless: "bg-stone-100 text-black border-stone-200",
};

const ENERGY_LETTER: Record<string, string> = {
  Fire:      "R",
  Water:     "W",
  Grass:     "G",
  Lightning: "L",
  Psychic:   "P",
  Fighting:  "F",
  Darkness:  "D",
  Metal:     "M",
  Fairy:     "Y",
  Dragon:    "N",
  Colorless: "C",
};

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

/* ─── Energy cost pill ───────────────────────────────────────── */

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
          Paste your TCG Live deck list for a clean breakdown — card types, Pokémon abilities and attacks, and meta positioning.
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

              {/* ── 1. Overview ─────────────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4">Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Total" value={result.deckSize} />
                  <Stat
                    label="Pokémon"
                    value={result.sections.pokemon}
                    sub={result.sections.pokemonRatio}
                    color="text-blue-600"
                  />
                  <Stat
                    label="Trainers"
                    value={result.sections.trainer}
                    sub={result.sections.trainerRatio}
                    color="text-green-600"
                  />
                  <Stat
                    label="Energy"
                    value={result.sections.energy}
                    sub={result.sections.energyRatio}
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

              {/* ── 2. Pokémon Breakdown ─────────────────────── */}
              <div className="rounded-xl border border-tan-200 bg-tan-100 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4">Pokémon Breakdown</h2>

                {/* Stat pills */}
                <div className="flex gap-3 mb-5">
                  <span className="inline-flex items-center rounded-full border border-tan-300 bg-tan-50 px-3 py-1 text-sm font-medium text-brown-700">
                    {result.pokemon.totalCards} Total Cards
                  </span>
                  <span className="inline-flex items-center rounded-full border border-tan-300 bg-tan-50 px-3 py-1 text-sm font-medium text-brown-700">
                    {result.pokemon.uniqueSpecies} Unique Species
                  </span>
                </div>

                {/* Abilities table */}
                {result.pokemon.abilities.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-sm font-semibold text-brown-700 mb-2">Abilities</h3>
                    <div className="border border-tan-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-tan-200">
                            <th className="text-left px-3 py-2 text-xs font-semibold text-brown-600 uppercase tracking-wide">
                              Pokémon
                            </th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-brown-600 uppercase tracking-wide">
                              Ability
                            </th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-brown-600 uppercase tracking-wide">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-tan-100">
                          {result.pokemon.abilities.map((ab, i) => (
                            <tr key={i} className="bg-tan-50 hover:bg-tan-100 transition-colors">
                              <td className="px-3 py-2.5 font-medium text-brown-900 whitespace-nowrap">
                                {ab.pokemonName}
                              </td>
                              <td className="px-3 py-2.5 text-energy font-medium whitespace-nowrap">
                                {ab.abilityName}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-brown-500 leading-relaxed">
                                {ab.description || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Attacks grouped by Pokémon */}
                {result.pokemon.attacks.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-brown-700 mb-2">Attacks</h3>
                    <div className="flex flex-col gap-3">
                      {(() => {
                        // Group attacks by pokemonName
                        const grouped = result.pokemon.attacks.reduce<Record<string, PokemonAttack[]>>(
                          (acc, atk) => {
                            if (!acc[atk.pokemonName]) acc[atk.pokemonName] = [];
                            acc[atk.pokemonName].push(atk);
                            return acc;
                          },
                          {}
                        );
                        return Object.entries(grouped).map(([pokemonName, attacks]) => (
                          <div key={pokemonName} className="border border-tan-200 rounded-xl overflow-hidden">
                            {/* Pokémon header */}
                            <div className="bg-tan-200 px-4 py-2">
                              <span className="text-sm font-semibold text-brown-800">{pokemonName}</span>
                            </div>
                            {/* Attacks for this Pokémon */}
                            <div className="divide-y divide-tan-100">
                              {attacks.map((atk, i) => (
                                <div key={i} className="bg-tan-50 px-4 py-3">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {/* Attack name */}
                                    <span className="font-semibold text-brown-900 text-sm">{atk.attackName}</span>
                                    {/* Cost pills */}
                                    {atk.cost.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {atk.cost.map((type, j) => (
                                          <EnergyCostPill key={j} type={type} />
                                        ))}
                                      </div>
                                    )}
                                    {/* Damage */}
                                    {atk.damage && (
                                      <span className="ml-auto font-bold text-brown-900 text-sm">{atk.damage}</span>
                                    )}
                                  </div>
                                  {/* Effect text */}
                                  {atk.description && (
                                    <p className="mt-1.5 text-xs text-brown-500 leading-relaxed">{atk.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {result.pokemon.abilities.length === 0 && result.pokemon.attacks.length === 0 && (
                  <p className="text-sm text-brown-400 italic">
                    No ability or attack data found — Pokémon may not be in the card database.
                  </p>
                )}
              </div>

              {/* ── 3. Meta Match ────────────────────────────── */}
              {result.metaMatch.matched && (
                <div className="rounded-xl border border-green-200 bg-green-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700 mb-2">
                        Top Meta Deck
                      </span>
                      <h2 className="text-xl font-bold text-green-900">
                        {result.metaMatch.archetypeName}
                      </h2>
                    </div>
                    {result.metaMatch.matchPct !== null && (
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-black text-green-700 leading-none">
                          {(result.metaMatch.matchPct * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">meta share</p>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-green-700 mt-2">
                    This deck matches a recognized archetype in the current top 20 meta.
                  </p>
                </div>
              )}

              {/* ── 4. Warnings ──────────────────────────────── */}
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
  sub,
  color = "text-brown-900",
}: {
  label: string;
  value: number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-brown-400 mt-0">{sub}</p>}
      <p className="text-xs text-brown-500 mt-0.5">{label}</p>
    </div>
  );
}
