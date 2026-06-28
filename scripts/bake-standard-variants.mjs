#!/usr/bin/env node
// Bake the `hasStandardVariant` flag into data/cards-standard.json.
//
// For every Pokémon name in the catalog, look at its CURRENT STANDARD
// printings (regulation marks G/H/I/J as of June 2026). When two of
// those printings differ on HP, attacks, or abilities, mark every
// printing of that name (legacy + standard) with hasStandardVariant =
// true. Otherwise (zero/one standard print, or multiple standard prints
// that compare identical), set false.
//
// The flag is set on every printing of the name — even legacy ones —
// because the question we answer is "is this name ambiguous when it
// shows up in modern play?", which doesn't depend on which printing the
// consumer happens to be looking at.
//
// Bump CURRENT_STANDARD_MARKS when the rotation moves.
//
// Non-Pokémon supertypes (Trainers, Energies) are not flagged — the
// disambiguation prompt that consumes this is specific to in-play Pokémon
// references in battle logs.
//
// Compare semantics:
//   HP        — numeric equality (string → number)
//   attacks   — set equality on (name, cost, convertedEnergyCost, damage, text)
//   abilities — set equality on (name, type, text)
//
// Run:
//   node scripts/bake-standard-variants.mjs           # bake + write back
//   node scripts/bake-standard-variants.mjs --dry-run # report only
//
// NOTE — the Python refresh pipeline (export_cards_standard.py) writes
// cards-standard.json from the upstream cards.db. After this script runs,
// the next pipeline refresh will overwrite the flag unless the Python
// script is updated with matching logic. Re-run this script after a
// pipeline refresh as a fallback.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "..", "data", "cards-standard.json");

const DRY_RUN = process.argv.includes("--dry-run");

// Regulation marks currently legal in Standard. Sourced from the
// catalog comment in lib/engine/catalog.ts ("G/H/I represent current
// Standard") plus J, which is the just-introduced next mark.
const CURRENT_STANDARD_MARKS = new Set(["G", "H", "I", "J"]);

/** Canonicalize HP — string or number → number | null. */
function hpKey(entry) {
  if (entry.hp == null) return null;
  if (typeof entry.hp === "number") return entry.hp;
  const n = Number(entry.hp);
  return Number.isFinite(n) ? n : null;
}

/** Canonicalize attacks into a comparable shape. Order-insensitive: sort
 *  by attack name so two prints that list attacks in a different order
 *  still compare equal. */
function attacksKey(entry) {
  const list = Array.isArray(entry.attacks) ? entry.attacks : [];
  return JSON.stringify(
    list
      .map((a) => ({
        name: a?.name ?? "",
        cost: Array.isArray(a?.cost) ? [...a.cost].sort() : [],
        convertedEnergyCost: a?.convertedEnergyCost ?? 0,
        damage: a?.damage ?? "",
        text: a?.text ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/** Same idea for abilities. */
function abilitiesKey(entry) {
  const list = Array.isArray(entry.abilities) ? entry.abilities : [];
  return JSON.stringify(
    list
      .map((a) => ({
        name: a?.name ?? "",
        type: a?.type ?? "",
        text: a?.text ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/** Combined signature. Two entries with identical sigs are mechanically
 *  interchangeable for the purpose of replay state. */
function signatureFor(entry) {
  return JSON.stringify({
    hp: hpKey(entry),
    attacks: attacksKey(entry),
    abilities: abilitiesKey(entry),
  });
}

function main() {
  const raw = readFileSync(JSON_PATH, "utf8");
  /** @type {Record<string, any[]>} */
  const data = JSON.parse(raw);

  let flaggedNames = 0;
  let flaggedPrintings = 0;
  let totalPokemonNames = 0;
  const exampleFlagged = [];

  for (const [name, printings] of Object.entries(data)) {
    if (!Array.isArray(printings) || printings.length === 0) continue;

    // Only consider Pokémon supertype — the disambiguation feature is
    // scoped to in-play Pokémon references in battle logs.
    const isPokemon = printings.some((p) => p?.supertype === "Pokémon");
    if (!isPokemon) {
      for (const p of printings) p.hasStandardVariant = false;
      continue;
    }
    totalPokemonNames += 1;

    const pokeOnly = printings.filter((p) => p?.supertype === "Pokémon");
    const standardPokeOnly = pokeOnly.filter((p) =>
      CURRENT_STANDARD_MARKS.has(p?.regulation_mark ?? ""),
    );
    const sigs = new Set(standardPokeOnly.map(signatureFor));
    const hasVariant = sigs.size > 1;

    for (const p of printings) p.hasStandardVariant = hasVariant;

    if (hasVariant) {
      flaggedNames += 1;
      flaggedPrintings += pokeOnly.length;
      if (exampleFlagged.length < 8) exampleFlagged.push(name);
    }
  }

  console.log(
    `Pokémon names scanned: ${totalPokemonNames}\n` +
      `Names flagged hasStandardVariant: ${flaggedNames}\n` +
      `Printings flagged: ${flaggedPrintings}\n` +
      `Example flagged names: ${exampleFlagged.join(", ")}`,
  );

  if (DRY_RUN) {
    console.log("\nDry-run — JSON not written.");
    return;
  }

  // Preserve the compact one-line shape the Python pipeline produces so
  // diffs stay small.
  writeFileSync(
    JSON_PATH,
    JSON.stringify(data, null, 0),
    "utf8",
  );
  console.log(`\nWrote ${JSON_PATH}`);
}

main();
