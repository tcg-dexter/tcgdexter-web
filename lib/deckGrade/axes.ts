import type {
  AxisResult,
  AxisStatus,
  CardRole,
  GradeCard,
  GradeInput,
  PlayStyle,
} from "./types";
import { hasRole, roleCopies, rolesForCard } from "./roles";
import {
  FORMAT_TOP_HP,
  attackCostTypes,
  clamp01,
  evolutionStage,
  isAttacker,
  isMultiPrize,
  pAtLeastOneInOpening,
  sumQty,
  topDamage,
} from "./helpers";

interface StyleTargets {
  energyBand: [number, number];
  drawSupporters: number;
  searchTarget: number;
  requiredRoles: CardRole[];
}

const STYLE_TARGETS: Record<PlayStyle, StyleTargets> = {
  aggro: { energyBand: [5, 10], drawSupporters: 7, searchTarget: 6, requiredRoles: ["draw", "search", "gust"] },
  midrange: { energyBand: [9, 13], drawSupporters: 9, searchTarget: 6, requiredRoles: ["draw", "search", "gust", "recovery"] },
  control: { energyBand: [8, 15], drawSupporters: 11, searchTarget: 4, requiredRoles: ["draw", "search", "gust", "disruption", "recovery"] },
  toolbox: { energyBand: [7, 12], drawSupporters: 9, searchTarget: 8, requiredRoles: ["draw", "search", "gust", "switch"] },
  combo: { energyBand: [6, 12], drawSupporters: 9, searchTarget: 8, requiredRoles: ["draw", "search", "gust"] },
};

const ROLE_LABEL: Record<CardRole, string> = {
  draw: "draw",
  search: "search",
  gust: "gust (Boss's Orders)",
  switch: "switch",
  recovery: "recovery",
  accel: "energy acceleration",
  disruption: "disruption",
  stadium: "stadium",
};

const isSupporter = (c: GradeCard) =>
  c.subtypes.some((s) => s.toLowerCase() === "supporter");

function statusFor(score: number): AxisStatus {
  if (score >= 80) return "good";
  if (score >= 55) return "warn";
  return "weak";
}

/** Score a value that should sit inside [lo, hi]; linear falloff outside. */
function bandScore(value: number, lo: number, hi: number): number {
  if (value >= lo && value <= hi) return 1;
  if (value < lo) return clamp01(value / lo);
  // Above the band: over-committing; gentle penalty.
  return clamp01(1 - (value - hi) / (hi + 6));
}

/* ─── Setup & Consistency ─────────────────────────────────────── */

export function scoreSetup(
  cards: GradeCard[],
  style: PlayStyle,
): AxisResult {
  const t = STYLE_TARGETS[style];
  const deckSize = sumQty(cards, () => true);
  const totalSupporters = sumQty(cards, isSupporter);
  const drawSupporterCopies = sumQty(cards, (c) => isSupporter(c) && rolesForCard(c).has("draw"));
  const searchCopies = roleCopies(cards, "search");

  const pSupporterT1 = pAtLeastOneInOpening(totalSupporters, deckSize);
  const supporterScore = clamp01(pSupporterT1 / 0.9);
  const drawScore = clamp01(drawSupporterCopies / t.drawSupporters);
  const searchScore = clamp01(searchCopies / t.searchTarget);

  const score = Math.round(
    100 * (0.4 * supporterScore + 0.35 * drawScore + 0.25 * searchScore),
  );

  // The draw engine (total supporters + draw-supporter density) and search
  // are the two levers; report whichever is the real bottleneck.
  let finding: string;
  let lever: string | null = null;
  const missWhiff = Math.round((1 - pSupporterT1) * 100);
  const drawEngine = Math.min(supporterScore, drawScore);
  if (score >= 78) {
    finding = `Draw engine looks healthy — ~${100 - missWhiff}% of hands open with a Supporter.`;
  } else if (searchScore < drawEngine) {
    finding = `Only ${searchCopies} search cards to find your key Pokémon.`;
    lever = `Add ${Math.max(1, t.searchTarget - searchCopies)} search items (e.g. Nest Ball / Ultra Ball).`;
  } else {
    finding = `${drawSupporterCopies} draw Supporters — ~${missWhiff}% of opening hands see no Supporter.`;
    lever = `Add ${Math.max(1, t.drawSupporters - drawSupporterCopies)} draw Supporters (e.g. Iono / Professor's Research).`;
  }

  return {
    key: "setup",
    label: "Setup & Consistency",
    score,
    weight: 25,
    target: `${t.drawSupporters}+ draw Supporters`,
    status: statusFor(score),
    finding,
    lever,
  };
}

/* ─── Energy System ───────────────────────────────────────────── */

export function scoreEnergy(
  cards: GradeCard[],
  style: PlayStyle,
): AxisResult {
  const t = STYLE_TARGETS[style];
  const attackers = cards.filter(isAttacker);

  const needed = new Set<string>();
  for (const a of attackers) attackCostTypes(a).forEach((ty) => needed.add(ty));

  const provided = new Set<string>();
  let hasFlexibleSpecial = false;
  for (const c of cards) {
    if (c.supertype !== "Energy") continue;
    if (c.isSpecialEnergy) hasFlexibleSpecial = true;
    c.energyProvides.forEach((ty) => provided.add(ty));
  }

  const unpayable = Array.from(needed).filter((ty) => !provided.has(ty));
  const orphan = Array.from(provided).filter((ty) => !needed.has(ty));
  const hasAccel = hasRole(cards, "accel");

  let unpayablePenalty = 0.5 * unpayable.length;
  if (hasFlexibleSpecial) unpayablePenalty *= 0.5; // special energy may cover it
  const matchScore = clamp01(1 - unpayablePenalty - 0.2 * orphan.length);

  const energyCount = sumQty(cards, (c) => c.supertype === "Energy");
  const countScore = bandScore(energyCount, t.energyBand[0], t.energyBand[1]);

  const needsSpeed = style === "aggro" || style === "combo";
  const accelFit = needsSpeed ? (hasAccel ? 1 : 0.6) : 1;

  // Type-match dominates: an energy base that can't power the attackers is a
  // critical failure regardless of a healthy count.
  const score = Math.round(
    100 * (0.65 * matchScore + 0.25 * countScore + 0.1 * accelFit),
  );

  let finding: string;
  let lever: string | null = null;
  if (unpayable.length > 0) {
    finding = `Your ${unpayable.join(" / ")} attackers have no matching Energy — you can't reliably power them.`;
    lever = `Add ${unpayable.join(" / ")} Energy or an acceleration source.`;
  } else if (orphan.length > 0) {
    finding = `${orphan.join(" / ")} Energy powers no attack in the deck — dead draws.`;
    lever = `Cut the ${orphan.join(" / ")} Energy for cards that advance your plan.`;
  } else if (countScore < 0.8) {
    finding = `Energy count (${energyCount}) is outside the ${t.energyBand[0]}–${t.energyBand[1]} range for a ${style} build.`;
    lever = energyCount < t.energyBand[0] ? "Add a couple of Energy." : "Trim an Energy or two for consistency.";
  } else {
    finding = `Energy types line up with your attackers.`;
  }

  return {
    key: "energy",
    label: "Energy System",
    score,
    weight: 25,
    target: `${t.energyBand[0]}–${t.energyBand[1]} energy, types matched`,
    status: statusFor(score),
    finding,
    lever,
  };
}

/* ─── Prize / Attacker Economy ────────────────────────────────── */

export function scorePrize(
  cards: GradeCard[],
  style: PlayStyle,
): AxisResult {
  const attackers = cards.filter(isAttacker);
  const attackerLines = attackers.length;
  const maxCopies = attackers.reduce((m, c) => Math.max(m, c.qty), 0);
  const deckTopDamage = attackers.reduce((m, c) => Math.max(m, topDamage(c)), 0);

  const anySinglePrize = attackers.some((c) => !isMultiPrize(c));
  const allMultiPrize = attackerLines > 0 && !anySinglePrize;

  const backupScore =
    attackerLines >= 2 ? 1 : maxCopies >= 3 ? 0.6 : attackerLines === 1 ? 0.3 : 0;
  const prizeMixScore = allMultiPrize ? (style === "aggro" ? 0.85 : 0.7) : 1;
  const damageScore = clamp01(deckTopDamage / (FORMAT_TOP_HP * 0.85));

  const isControl = style === "control";
  const score = Math.round(
    100 *
      (isControl
        ? 0.5 * backupScore + 0.3 * prizeMixScore + 0.2 * Math.max(damageScore, 0.6)
        : 0.4 * backupScore + 0.25 * prizeMixScore + 0.35 * damageScore),
  );

  let finding: string;
  let lever: string | null = null;
  if (attackerLines === 0) {
    finding = `No damage-dealing attacker found — the deck can't take prizes.`;
    lever = `Add a primary attacker line.`;
  } else if (backupScore < 0.6) {
    finding = `One attacker line with no backup — a single early KO stalls you.`;
    lever = `Add a secondary attacker or deepen the main line.`;
  } else if (!isControl && damageScore < 0.7) {
    finding = `Top attack (${deckTopDamage}) can't threaten the format's ~${FORMAT_TOP_HP}-HP ex's.`;
    lever = `Add a heavier hitter or damage modifiers.`;
  } else if (allMultiPrize && !isControl) {
    finding = `Every attacker gives up 2+ prizes when KO'd — no single-prize option to break the prize trade.`;
    lever = `Consider a single-prize attacker to shift the race.`;
  } else {
    finding = `Prize plan looks solid — enough attackers and damage to close games.`;
  }

  return {
    key: "prize",
    label: "Prize & Attacker Economy",
    score,
    weight: 20,
    target: `2+ attacker lines, threatens ${FORMAT_TOP_HP} HP`,
    status: statusFor(score),
    finding,
    lever,
  };
}

/* ─── Evolution Integrity ─────────────────────────────────────── */

export function scoreEvolution(cards: GradeCard[]): AxisResult {
  const pokemon = cards.filter((c) => c.supertype === "Pokémon");
  const evolved = pokemon.filter((c) => evolutionStage(c) >= 1);

  if (evolved.length === 0) {
    return {
      key: "evolution",
      label: "Evolution Integrity",
      score: 100,
      weight: 15,
      target: "complete lines",
      status: "good",
      finding: `All-Basic build — no evolution lines to misbuild.`,
      lever: null,
    };
  }

  const qtyByName = new Map<string, number>();
  for (const c of pokemon) qtyByName.set(c.name.toLowerCase(), c.qty);
  const hasRareCandy = cards.some((c) => c.name.toLowerCase() === "rare candy");
  const basicPokemonCopies = sumQty(pokemon, (c) => evolutionStage(c) === 0);

  let score = 100;
  const problems: string[] = [];
  for (const c of evolved) {
    const pre = c.evolvesFrom?.toLowerCase() ?? null;
    const preCopies = pre ? qtyByName.get(pre) ?? 0 : 0;
    const stage = evolutionStage(c);

    if (preCopies === 0 && !(stage === 2 && hasRareCandy)) {
      score -= 35;
      problems.push(`${c.name} has no ${c.evolvesFrom ?? "pre-evolution"}${stage === 2 ? " or Rare Candy" : ""}`);
    } else if (preCopies > 0 && preCopies < c.qty) {
      score -= 12;
      problems.push(`${c.name} line is top-heavy (${preCopies}→${c.qty})`);
    }
  }
  if (basicPokemonCopies < 6) {
    score -= (6 - basicPokemonCopies) * 3;
    problems.push(`only ${basicPokemonCopies} Basic Pokémon — brick risk`);
  }
  score = Math.max(0, Math.round(score));

  const finding = problems.length
    ? problems[0].charAt(0).toUpperCase() + problems[0].slice(1) + "."
    : `Evolution lines are complete and well-proportioned.`;
  const lever = problems.length
    ? `Fix line ratios (add pre-evolutions / Rare Candy) and keep ~8+ Basics.`
    : null;

  return {
    key: "evolution",
    label: "Evolution Integrity",
    score,
    weight: 15,
    target: "complete, bottom-heavy lines",
    status: statusFor(score),
    finding,
    lever,
  };
}

/* ─── Trainer Toolbox Coverage ────────────────────────────────── */

export function scoreToolbox(
  cards: GradeCard[],
  style: PlayStyle,
): AxisResult {
  const required = STYLE_TARGETS[style].requiredRoles;
  // Gust is close to mandatory — weight it double.
  const weightOf = (r: CardRole) => (r === "gust" ? 2 : 1);

  let have = 0;
  let total = 0;
  const missing: CardRole[] = [];
  for (const r of required) {
    total += weightOf(r);
    if (hasRole(cards, r)) have += weightOf(r);
    else missing.push(r);
  }
  const score = total > 0 ? Math.round((100 * have) / total) : 100;

  let finding: string;
  let lever: string | null = null;
  if (missing.includes("gust")) {
    finding = `No gust effect — you can't drag up the Pokémon you need to KO.`;
    lever = `Add 1–2 Boss's Orders.`;
  } else if (missing.length > 0) {
    finding = `Missing ${missing.map((r) => ROLE_LABEL[r]).join(", ")} for a ${style} build.`;
    lever = `Add cards covering: ${missing.map((r) => ROLE_LABEL[r]).join(", ")}.`;
  } else {
    finding = `Support suite covers the key roles for this style.`;
  }

  return {
    key: "toolbox",
    label: "Trainer Toolbox",
    score,
    weight: 15,
    target: required.map((r) => ROLE_LABEL[r]).join(" · "),
    status: statusFor(score),
    finding,
    lever,
  };
}

/* ─── Meta Fit (informational, unscored) ──────────────────────── */

export function scoreMeta(meta: GradeInput["meta"]): AxisResult {
  const matched = !!meta?.archetypeName;
  const parts: string[] = [];
  if (matched) {
    parts.push(`Matches ${meta!.archetypeName}`);
    if (meta!.rank) parts.push(`#${meta!.rank} in Standard`);
    if (meta!.conversionRate != null)
      parts.push(`${Math.round(meta!.conversionRate * 100)}% top-cut conversion`);
  }
  return {
    key: "meta",
    label: "Meta Fit",
    score: 100,
    weight: 0,
    status: "info",
    finding: matched
      ? parts.join(" · ")
      : `No strong meta match — an original build.`,
    lever: null,
  };
}
