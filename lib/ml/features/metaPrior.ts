// What ELSE is in their deck, given what they have shown us.
//
// A Pokémon TCG position is mostly hidden information: we see their board,
// their discard, and nothing else. But decks in a format are not random bags
// of 60 cards — they are ~30 recognisable archetypes, and a single revealed
// Pokémon is often enough to name one. A human pilot does this constantly
// ("that's Dragapult, so they hold Counter Catcher"), and every model we have
// trained so far has been blind to it: the state encoder counts what is
// visible and stops.
//
// This module turns revealed cards into a posterior over archetypes, and the
// posterior into an expectation over the cards we have NOT seen.
//
// METHOD. Naive Bayes over card presence, per archetype, with Laplace
// smoothing. Naive is the right call and not merely the easy one: the
// independence assumption is wrong (cards come in engines, not singly), but
// the failure mode of a wrong independence assumption is an over-confident
// posterior, and we consume the posterior as an EXPECTATION over mechanics
// rather than as a hard archetype label. A softmax that is too sharp still
// points at the right neighbourhood.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not tell the planner a threat
// exists. lib/ml/features/threat.ts prices what is POSSIBLE from the visible
// board and the format's evolution graph — exactly, with no probability
// involved. This module prices what is LIKELY. Keeping them separate means a
// mis-calibrated prior can never suppress a real, visible threat; the worst
// it can do is misjudge a hidden one.
//
// The corpus it learns from is the format-legal one — loadMetaCorpus filters
// through legalityIssues, which now enforces regulation marks — so a rotated
// staple cannot enter the prior and be "expected" in a deck that cannot run it.

import { buildCorpus, loadMetaCorpus, type CorpusDeck } from "@/lib/ml/deckGen/corpus";
import { MECHANICS_FIELDS, mechanicsOf } from "./cardMechanics";
import { legalCard } from "@/lib/ml/format";

/** Bump when the prior's structure or feature list changes. */
export const META_PRIOR_VERSION = 1;

interface ArchetypeModel {
  id: string;
  /** Prior share of the field, normalized across archetypes. */
  prior: number;
  /** name -> fraction of this archetype's variants that run the card. */
  presence: Map<string, number>;
  /** Mean copies of each card across this archetype's variants. */
  meanQty: Map<string, number>;
  /** Highest printed attack damage anywhere in the archetype. */
  maxAttackerDamage: number;
  nVariants: number;
}

interface PriorIndex {
  archetypes: ArchetypeModel[];
  /** Cards seen in ANY archetype — the Bayes vocabulary. */
  vocabulary: Set<string>;
  /** How discriminative a card is: 1 − (share of archetypes running it).
   *  A card every deck plays says nothing; a signature Pokémon says a lot. */
  informativeness: Map<string, number>;
}

let INDEX: PriorIndex | null = null;

function maxDamageOf(name: string): number {
  const card = legalCard(name);
  if (!card || card.supertype !== "Pokémon") return 0;
  let best = 0;
  for (const a of card.attacks ?? []) {
    const n = parseInt(a.damage, 10);
    if (Number.isFinite(n)) best = Math.max(best, n);
  }
  return best;
}

function build(): PriorIndex {
  const decks = loadMetaCorpus();
  const byArchetype = new Map<string, CorpusDeck[]>();
  for (const d of decks) {
    const key = d.archetype ?? "unknown";
    byArchetype.set(key, [...(byArchetype.get(key) ?? []), d]);
  }

  const archetypes: ArchetypeModel[] = [];
  const vocabulary = new Set<string>();
  for (const [id, variants] of Array.from(byArchetype)) {
    const presence = new Map<string, number>();
    const meanQty = new Map<string, number>();
    let maxAttackerDamage = 0;
    for (const v of variants) {
      const seen = new Set<string>();
      for (const e of v.entries) {
        if (e.qty <= 0) continue;
        vocabulary.add(e.name);
        if (!seen.has(e.name)) {
          presence.set(e.name, (presence.get(e.name) ?? 0) + 1);
          seen.add(e.name);
        }
        meanQty.set(e.name, (meanQty.get(e.name) ?? 0) + e.qty);
        maxAttackerDamage = Math.max(maxAttackerDamage, maxDamageOf(e.name));
      }
    }
    for (const [k, v] of Array.from(presence)) presence.set(k, v / variants.length);
    for (const [k, v] of Array.from(meanQty)) meanQty.set(k, v / variants.length);
    archetypes.push({
      id,
      // Field representation is the honest prior, but an archetype with 0
      // recorded share must not get probability 0 — that would make it
      // unreachable no matter what cards we see.
      prior: Math.max(variants[0]?.representation ?? 0, 0.1),
      presence,
      meanQty,
      maxAttackerDamage,
      nVariants: variants.length,
    });
  }
  const total = archetypes.reduce((s, a) => s + a.prior, 0) || 1;
  for (const a of archetypes) a.prior /= total;

  const informativeness = new Map<string, number>();
  for (const name of Array.from(vocabulary)) {
    const share = archetypes.filter((a) => (a.presence.get(name) ?? 0) > 0).length / archetypes.length;
    informativeness.set(name, 1 - share);
  }

  return { archetypes, vocabulary, informativeness };
}

function index(): PriorIndex {
  if (!INDEX) INDEX = build();
  return INDEX;
}

/** Posterior over archetypes given the cards revealed so far.
 *
 *  Laplace-smoothed so a single off-list tech card cannot zero out the
 *  archetype it actually came from — real lists carry one-ofs the recorded
 *  variants missed, and a hard zero there would be a confident wrong answer. */
export function archetypePosterior(revealed: readonly string[]): Map<string, number> {
  const idx = index();
  const useful = revealed.filter((n) => idx.vocabulary.has(n));
  const logp = idx.archetypes.map((a) => {
    let lp = Math.log(a.prior);
    for (const name of useful) {
      const p = a.presence.get(name) ?? 0;
      // Smoothing weighted by how many variants back the estimate.
      const smoothed = (p * a.nVariants + 0.5) / (a.nVariants + 1);
      lp += Math.log(smoothed);
    }
    return lp;
  });
  const max = Math.max(...logp);
  const exp = logp.map((l) => Math.exp(l - max));
  const sum = exp.reduce((s, x) => s + x, 0) || 1;
  const out = new Map<string, number>();
  idx.archetypes.forEach((a, i) => out.set(a.id, exp[i] / sum));
  return out;
}

export interface MetaPrior {
  /** Probability mass on the single most likely archetype. */
  confidence: number;
  /** Normalized Shannon entropy of the posterior, 0 (certain) to 1 (uniform).
   *  This is the model's own "do I know what I'm playing against". */
  entropy: number;
  /** How many revealed cards were in the vocabulary at all. */
  observed: number;
  /** Sum of informativeness over revealed cards — reading one Ultra Ball is
   *  not the same evidence as reading one Dragapult. */
  evidence: number;
  /** Expected highest-damage attacker anywhere in their list. */
  expected_max_attacker: number;
  /** Posterior-weighted expected copies of key disruption in their deck. */
  expected_gust: number;
  expected_draw: number;
  expected_search: number;
  expected_energy_accel: number;
  expected_disruption: number;
}

export const META_PRIOR_FIELDS: readonly (keyof MetaPrior)[] = [
  "confidence",
  "entropy",
  "observed",
  "evidence",
  "expected_max_attacker",
  "expected_gust",
  "expected_draw",
  "expected_search",
  "expected_energy_accel",
  "expected_disruption",
];

const ZERO: MetaPrior = {
  confidence: 0,
  entropy: 1,
  observed: 0,
  evidence: 0,
  expected_max_attacker: 0,
  expected_gust: 0,
  expected_draw: 0,
  expected_search: 0,
  expected_energy_accel: 0,
  expected_disruption: 0,
};

export function metaPriorFeatureNames(prefix: string): string[] {
  return META_PRIOR_FIELDS.map((f) => `${prefix}_${f}`);
}

/** Cache the per-archetype mechanical expectation — it depends only on the
 *  corpus, and recomputing it per decision would walk every list every time. */
let ARCH_MECH: Map<string, Record<string, number>> | null = null;

function archetypeMechanics(): Map<string, Record<string, number>> {
  if (ARCH_MECH) return ARCH_MECH;
  const out = new Map<string, Record<string, number>>();
  for (const a of index().archetypes) {
    const agg: Record<string, number> = {};
    for (const f of MECHANICS_FIELDS) agg[f] = 0;
    for (const [name, qty] of Array.from(a.meanQty)) {
      const m = mechanicsOf(name);
      for (const f of MECHANICS_FIELDS) agg[f] += m[f] * qty;
    }
    out.set(a.id, agg);
  }
  ARCH_MECH = out;
  return out;
}

/** Everything the meta prior can say, given the opponent cards we have seen.
 *
 *  `revealed` should be every opponent card we have observed all game — board,
 *  discard, stadium, anything named in the log — not just what is in play now.
 *  A Pokémon that was KO'd three turns ago still identifies the deck. */
export function metaPrior(revealed: readonly string[]): MetaPrior {
  const idx = index();
  const useful = revealed.filter((n) => idx.vocabulary.has(n));
  if (useful.length === 0) return { ...ZERO };

  const post = archetypePosterior(revealed);
  const ps = Array.from(post.values());
  const confidence = Math.max(...ps, 0);
  const h = -ps.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
  const entropy = ps.length > 1 ? h / Math.log(ps.length) : 0;

  const mech = archetypeMechanics();
  let maxAttacker = 0;
  const exp: Record<string, number> = { gust: 0, draw_power: 0, search_power: 0, energy_accel: 0, disruption: 0 };
  for (const a of idx.archetypes) {
    const p = post.get(a.id) ?? 0;
    if (p <= 0) continue;
    maxAttacker += p * a.maxAttackerDamage;
    const m = mech.get(a.id)!;
    exp.gust += p * m.gust;
    exp.draw_power += p * m.draw_power;
    exp.search_power += p * m.search_power;
    exp.energy_accel += p * m.energy_accel;
    exp.disruption += p * m.disruption;
  }

  return {
    confidence,
    entropy,
    observed: useful.length,
    evidence: useful.reduce((s, n) => s + (idx.informativeness.get(n) ?? 0), 0),
    expected_max_attacker: maxAttacker,
    expected_gust: exp.gust,
    expected_draw: exp.draw_power,
    expected_search: exp.search_power,
    expected_energy_accel: exp.energy_accel,
    expected_disruption: exp.disruption,
  };
}

export function metaPriorVector(revealed: readonly string[]): number[] {
  const p = metaPrior(revealed);
  return META_PRIOR_FIELDS.map((f) => p[f]);
}

/** The archetypes the prior knows about, most likely first. Diagnostic — the
 *  encoder consumes the aggregate, but a human debugging a route wants to see
 *  what the model thinks it is playing against. */
export function topArchetypes(revealed: readonly string[], k = 3): { id: string; p: number }[] {
  return Array.from(archetypePosterior(revealed))
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, k);
}

/** Cards this posterior expects to see that we have NOT seen yet, ranked by
 *  expected remaining copies. This is the "likely associated cards" view. */
export function expectedUnseen(revealed: readonly string[], k = 10): { name: string; qty: number }[] {
  const post = archetypePosterior(revealed);
  const seen = new Set(revealed);
  const acc = new Map<string, number>();
  for (const a of index().archetypes) {
    const p = post.get(a.id) ?? 0;
    if (p <= 0.001) continue;
    for (const [name, qty] of Array.from(a.meanQty)) {
      if (seen.has(name)) continue;
      acc.set(name, (acc.get(name) ?? 0) + p * qty);
    }
  }
  return Array.from(acc)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, k);
}

/** Exposed so callers can confirm the prior was built from a legal corpus. */
export function priorCorpusSize(): { archetypes: number; vocabulary: number } {
  const i = index();
  return { archetypes: i.archetypes.length, vocabulary: i.vocabulary.size };
}

export { buildCorpus };
