#!/usr/bin/env node
/**
 * Build a deduped, alphabetized list of base Pokémon names from
 * data/cards-standard.json and emit it to public/pokemon-names.json.
 *
 * The client uses this list to drive the team-of-6 picker on
 * /u/[username]. Sprite URLs are derived at render time via the same
 * `pokemonSlug()` helper used elsewhere in the app, so we store only
 * names here — no URLs.
 *
 * Run once when card data changes and commit the output:
 *   node scripts/build-pokemon-names.mjs
 *
 * Output ships from /public (CDN-cached on Vercel) so search runs
 * entirely client-side with zero per-keystroke server cost.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SUFFIX_TOKENS = new Set([
  "ex",
  "v",
  "vmax",
  "vstar",
  "gx",
  "mega",
  "tag",
  "team",
]);

/** Dedup slug. More aggressive than the runtime `pokemonSlug` —
 *  iteratively strips trailing `-<suffix>` tokens AND single-letter
 *  trailing tokens (e.g. "Absol G" / "Absol G LVX" / "Absol-EX" all
 *  collapse to "absol"). The runtime sprite URL is still resolved via
 *  the canonical pokemonSlug on the kept display name. */
const TRAILING_NOISE = new Set([
  ...SUFFIX_TOKENS,
  "lvx", // LV.X
  "level",
  "lv",
  "delta",
  "prime",
  "break",
  "star",
  "promo",
]);

function stripNoise(tokens) {
  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    const last = tokens[tokens.length - 1];
    const lastLower = last.toLowerCase();
    // Whole trailing token (only when something remains after).
    if (
      tokens.length > 1 &&
      (TRAILING_NOISE.has(lastLower) || /^[a-z]$/.test(lastLower))
    ) {
      tokens.pop();
      changed = true;
      continue;
    }
    // Hyphen-attached suffix on the last token. Fires even with one
    // remaining token, so "absol-ex" collapses to "absol".
    const parts = last.split("-");
    if (
      parts.length > 1 &&
      TRAILING_NOISE.has(parts[parts.length - 1].toLowerCase())
    ) {
      tokens[tokens.length - 1] = parts.slice(0, -1).join("-");
      changed = true;
    }
  }
  return tokens;
}

function dedupeSlug(name) {
  let tokens = name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Drop leading short trainer-possessive tokens ("ns" from "N's",
  // "steves" → keep, "ashs" → keep, since they're > 2 chars). Bail
  // if it would consume everything.
  while (tokens.length > 1 && tokens[0].length <= 2) tokens.shift();

  return stripNoise(tokens).join("-");
}

/** Strip the same noise tokens from the display name. Preserves
 *  original casing AND apostrophes (e.g. "Ash's Pikachu" stays
 *  "Ash's Pikachu", "Pikachu-EX" → "Pikachu", "Absol G LVX" →
 *  "Absol"). */
function displayName(name) {
  let tokens = name.split(/\s+/).filter(Boolean);
  // Don't strip leading short tokens here — we want "N's Zoroark" to
  // display as "N's Zoroark". Dedup already picks the shortest variant
  // per slug, so cleaner display names win when available.
  return stripNoise(tokens).join(" ");
}

const cardsPath = resolve(process.cwd(), "data/cards-standard.json");
const outPath = resolve(process.cwd(), "public/pokemon-names.json");

console.log(`Reading ${cardsPath}…`);
const cards = JSON.parse(readFileSync(cardsPath, "utf8"));

/** slug → { name, slug }. Dedupes by slug, prefers the shortest display
 *  name (typically the cleanest base form). */
const bySlug = new Map();

for (const [cardName, printings] of Object.entries(cards)) {
  // Only Pokémon (skip Trainers / Energy)
  const first = Array.isArray(printings) ? printings[0] : null;
  if (!first || first.supertype !== "Pokémon") continue;

  const slug = dedupeSlug(cardName);
  if (!slug) continue;

  const display = displayName(cardName);
  if (!display) continue;

  const existing = bySlug.get(slug);
  if (!existing || display.length < existing.length) {
    bySlug.set(slug, display);
  }
}

const names = [...bySlug.values()].sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" })
);

writeFileSync(outPath, JSON.stringify(names));
const sizeKb = (JSON.stringify(names).length / 1024).toFixed(1);
console.log(`Wrote ${names.length} names to ${outPath} (${sizeKb} KB)`);
