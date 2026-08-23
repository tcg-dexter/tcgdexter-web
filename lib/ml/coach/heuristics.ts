// Coach v1 — deterministic, explainable insight detection over Phase-1
// feature rows. No learned components: every insight is a rule a human
// coach could state, with the evidence (turn numbers, counts) inline.
// Works from battle #1; learned turn-quality grading replaces individual
// rules only when the corpus crosses its data threshold (spec Phase 2+).
//
// Pure over plain data (BattleLogFeatures + flagged TurnFeatures) so the
// rules are unit-testable without engine state.

import type { BattleLogFeatures, TurnFeatures, TurnQualityFlags } from "@/lib/ml/features";

export type FlaggedTurn = TurnFeatures & TurnQualityFlags;

export interface CoachInsight {
  /** Stable machine id, e.g. "missed_energy". Codes are part of the API
   *  contract — the UI keys icons/ordering off them. */
  code: string;
  severity: "warning" | "suggestion" | "info";
  /** Turn the insight anchors to, or null for battle-level insights. */
  turn_number: number | null;
  title: string;
  detail: string;
}

export interface CoachReport {
  insights: CoachInsight[];
  /** Player-turn counts backing the report, for the UI's summary strip. */
  summary: {
    player_turns: number;
    turns_missed_energy: number;
    turns_no_supporter: number;
    passive_turns: number;
    prizes_player: number | null;
    prizes_opponent: number | null;
  };
}

const SEVERITY_ORDER: Record<CoachInsight["severity"], number> = {
  warning: 0,
  suggestion: 1,
  info: 2,
};

function listTurns(turns: number[]): string {
  return turns.length <= 6
    ? turns.join(", ")
    : `${turns.slice(0, 6).join(", ")} +${turns.length - 6} more`;
}

export function buildCoachReport(
  battle: BattleLogFeatures,
  turns: FlaggedTurn[],
): CoachReport {
  const insights: CoachInsight[] = [];
  const playerTurns = turns.filter((t) => t.actor === "player");

  /* ── Energy attachments ─────────────────────────────────────── */
  const missedEnergy = playerTurns.filter((t) => t.flag_missed_energy_attach);
  if (missedEnergy.length > 0) {
    insights.push({
      code: "missed_energy",
      severity: missedEnergy.length >= 2 ? "warning" : "suggestion",
      turn_number: missedEnergy[0].turn_number,
      title: `No energy attached on ${missedEnergy.length} of ${playerTurns.length} turns`,
      detail:
        `You skipped your energy attachment on turn${missedEnergy.length > 1 ? "s" : ""} ` +
        `${listTurns(missedEnergy.map((t) => t.turn_number))}. The once-per-turn attachment ` +
        `is free tempo — missing it usually delays your attacker by a full turn.`,
    });
  }

  /* ── Passive turns ──────────────────────────────────────────── */
  const passive = playerTurns.filter((t) => t.flag_passive_turn);
  if (passive.length > 0) {
    insights.push({
      code: "passive_turns",
      severity: "warning",
      turn_number: passive[0].turn_number,
      title: `${passive.length} turn${passive.length > 1 ? "s" : ""} with no board progress`,
      detail:
        `On turn${passive.length > 1 ? "s" : ""} ${listTurns(passive.map((t) => t.turn_number))} ` +
        `you didn't attack, attach energy, evolve, or use an ability. Even when stuck, look for ` +
        `a draw supporter or bench development to convert dead turns into setup.`,
    });
  }

  /* ── Supporter usage ────────────────────────────────────────── */
  const noSupporter = playerTurns.filter((t) => t.flag_no_supporter);
  if (playerTurns.length >= 4 && noSupporter.length / playerTurns.length >= 0.5) {
    insights.push({
      code: "supporter_drought",
      severity: "suggestion",
      turn_number: null,
      title: `Supporter played on only ${playerTurns.length - noSupporter.length} of ${playerTurns.length} turns`,
      detail:
        `Draw supporters are the main engine in most lists. Missing them on half your turns ` +
        `(turns ${listTurns(noSupporter.map((t) => t.turn_number))}) usually points at a thin ` +
        `supporter line or holding them too long.`,
    });
  }

  /* ── Over-retreating ────────────────────────────────────────── */
  for (const t of playerTurns.filter((t) => t.flag_over_retreat)) {
    insights.push({
      code: "over_retreat",
      severity: "suggestion",
      turn_number: t.turn_number,
      title: `Expensive retreating on turn ${t.turn_number}`,
      detail:
        t.retreats >= 2
          ? `You retreated ${t.retreats} times in one turn. Consider a switching card to save the energy.`
          : `Retreating cost you ${t.retreat_energy_discarded} energy this turn — often worth a ` +
            `switching card or a different attacker order instead.`,
    });
  }

  /* ── Missed evolutions (only observable when the hand is known) ── */
  const missedEvo = playerTurns.filter((t) => t.flag_missed_evolution);
  for (const t of missedEvo) {
    insights.push({
      code: "missed_evolution",
      severity: "warning",
      turn_number: t.turn_number,
      title: `Evolution left in hand on turn ${t.turn_number}`,
      detail:
        `You held an evolution for a Pokémon that was eligible to evolve and ended the turn ` +
        `without playing it. Evolving early banks HP and attack options before it matters.`,
    });
  }

  /* ── Prize-trade economics ──────────────────────────────────── */
  const kosBy = battle.kos_by_player ?? 0;
  const kosAgainst = battle.kos_by_opponent ?? 0;
  const prizesP = battle.prizes_player ?? 0;
  const prizesO = battle.prizes_opponent ?? 0;
  if (kosAgainst > 0 && prizesO / kosAgainst >= 2 && (kosBy === 0 || prizesP / kosBy < prizesO / kosAgainst)) {
    insights.push({
      code: "prize_trade",
      severity: "warning",
      turn_number: null,
      title: `Opponent averaged ${(prizesO / kosAgainst).toFixed(1)} prizes per KO`,
      detail:
        `Your knockouts gave up multi-prize Pokémon (${prizesO} prizes over ${kosAgainst} KOs) while ` +
        `you took ${prizesP} over ${kosBy || "no"} KO${kosBy === 1 ? "" : "s"}. Leading with ` +
        `single-prize attackers or hiding support ex/V Pokémon flips that math.`,
    });
  }
  const bigGiveaways = turns.filter((t) => t.actor === "opponent" && t.prizes_taken >= 2);
  for (const t of bigGiveaways) {
    insights.push({
      code: "multi_prize_ko",
      severity: "info",
      turn_number: t.turn_number,
      title: `Gave up ${t.prizes_taken} prizes on turn ${t.turn_number}`,
      detail: `A multi-prize Pokémon went down on turn ${t.turn_number}. Worth reviewing whether it needed to be exposed.`,
    });
  }

  /* ── Tempo ──────────────────────────────────────────────────── */
  if (
    battle.first_attack_turn_player !== null &&
    battle.first_attack_turn_opponent !== null &&
    battle.first_attack_turn_player - battle.first_attack_turn_opponent >= 3
  ) {
    insights.push({
      code: "slow_start",
      severity: "suggestion",
      turn_number: battle.first_attack_turn_player,
      title: "Slow start: opponent attacked first by a wide margin",
      detail:
        `Your first attack landed on turn ${battle.first_attack_turn_player}, the opponent's on ` +
        `turn ${battle.first_attack_turn_opponent}. If this repeats across games, look at the ` +
        `energy count and early-search lines.`,
    });
  }

  /* ── Stranded resources ─────────────────────────────────────── */
  if ((battle.stranded_energy_final_player ?? 0) >= 3) {
    insights.push({
      code: "stranded_energy",
      severity: "suggestion",
      turn_number: null,
      title: `${battle.stranded_energy_final_player} energy stranded on the bench at game end`,
      detail:
        `Energy left on benched Pokémon when the game ended did no work. Concentrating ` +
        `attachments on the active line (or planning the next attacker earlier) converts them into damage.`,
    });
  }

  /* ── Consistency info ───────────────────────────────────────── */
  if ((battle.player_mulligans ?? 0) >= 2) {
    insights.push({
      code: "mulligans",
      severity: "info",
      turn_number: null,
      title: `${battle.player_mulligans} mulligans this game`,
      detail: `Repeated mulligans hint at a low Basic count for this list.`,
    });
  }
  if ((battle.max_prize_deficit ?? 0) <= -4 && prizesP > prizesO) {
    insights.push({
      code: "comeback",
      severity: "info",
      turn_number: null,
      title: "Comeback win from a 4-prize deficit",
      detail: `You were down ${Math.abs(battle.max_prize_deficit!)} prizes and still closed it out.`,
    });
  }

  insights.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.turn_number ?? 0) - (b.turn_number ?? 0),
  );

  return {
    insights,
    summary: {
      player_turns: playerTurns.length,
      turns_missed_energy: missedEnergy.length,
      turns_no_supporter: noSupporter.length,
      passive_turns: passive.length,
      prizes_player: battle.prizes_player,
      prizes_opponent: battle.prizes_opponent,
    },
  };
}
