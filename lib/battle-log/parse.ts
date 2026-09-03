// Pattern-based parser for TCG Live battle logs.
//
// Strategy: each primary block text is matched against an ordered list
// of regex patterns. The first match wins. The parser also inspects the
// block's children to extract sub-events (card lists, damage breakdowns,
// follow-up discards) into the resulting action's payload OR as their
// own subsequent actions when they carry meaningful state changes.
//
// Player perspective ("player" vs "opponent") is NOT decided here — the
// parser emits raw handles, and lib/battle-log/normalize.ts applies the
// chosen player handle to map handles to actors.

import {
  PARSER_VERSION,
  type ParsedAction,
  type ParsedTurn,
  type BattleLogParseResult,
  type SpecialCondition,
} from "./types";
import { tokenize, type Block, type Section } from "./tokenize";
import {
  CARD_NAME_ARRAY_FIELDS,
  CARD_NAME_FIELDS,
  CARD_NAME_GROUPED_FIELDS,
  splitCardId,
  stripCardIds,
} from "./cardId";

/* ─── Helpers ─────────────────────────────────────────────────── */

/**
 * Strip TCG Live card-id prefixes ("(me2-5_155) N's Zekrom") out of an
 * action's card-name payload fields and its raw_text, recording each clean
 * name → id into the shared map. A no-op on the standard export. Patterns
 * capture the id together with the name (they use `.+?`), so this runs once
 * per action after matching rather than complicating every regex.
 */
// Fields naming a Pokémon INSTANCE (not an energy/trainer). For these we keep
// the stripped printing id on a companion `${field}_id` so the reducer can tell
// two same-named-but-different-printing Pokémon apart when resolving a target —
// the global name→id map is lossy (first id wins), so per-occurrence is needed.
const POKEMON_ID_FIELDS = new Set<string>([
  "card",
  "target",
  "from",
  "to",
  "pokemon",
  "source",
  "attacker",
  "defender",
]);

function stripActionCardIds(a: ParsedAction, ids: Record<string, string>): void {
  for (const f of CARD_NAME_FIELDS) {
    const v = a.payload[f];
    if (typeof v === "string") {
      const { name, id } = splitCardId(v);
      a.payload[f] = name;
      if (id && POKEMON_ID_FIELDS.has(f)) a.payload[`${f}_id`] = id;
      if (id && !(name in ids)) ids[name] = id;
    }
  }
  for (const f of CARD_NAME_ARRAY_FIELDS) {
    const v = a.payload[f];
    if (Array.isArray(v)) {
      a.payload[f] = v.map((item) => {
        if (typeof item !== "string") return item;
        const { name, id } = splitCardId(item);
        if (id && !(name in ids)) ids[name] = id;
        return name;
      });
    }
  }
  for (const f of CARD_NAME_GROUPED_FIELDS) {
    const v = a.payload[f];
    if (Array.isArray(v)) {
      a.payload[f] = v.map((group) => {
        if (
          typeof group !== "object" ||
          group === null ||
          !Array.isArray((group as { cards?: unknown }).cards)
        ) {
          return group;
        }
        const g = group as { cards: string[] };
        return {
          ...g,
          cards: g.cards.map((item) => {
            const { name, id } = splitCardId(item);
            if (id && !(name in ids)) ids[name] = id;
            return name;
          }),
        };
      });
    }
  }
  a.raw_text = stripCardIds(a.raw_text);
}

/** Normalize curly apostrophes/quotes to straight so a single pattern matches. */
function normalizeQuotes(s: string): string {
  return s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

/** Split a comma-separated list of card names (the bullet child format). */
function splitCardList(text: string): string[] {
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectRevealedCards(block: Block): string[] {
  const out: string[] = [];
  for (const child of block.children) {
    if (child.kind === "bullet") {
      out.push(...splitCardList(child.text));
    }
  }
  return out;
}

interface DiscardDraw {
  /** Names of the cards sent to the discard as this action's cost. */
  discarded: string[];
  /** Names of the cards drawn. Can be shorter than `drawnCount` — see below. */
  drawn: string[];
  /** How many cards were drawn in total. The log sometimes reports a bare
   *  count with no card list (the verbose export does this), so this is the
   *  count to trust; `drawn` is what we could actually name. */
  drawnCount: number;
  /** Each "drew N cards" line's N, in order. Only kept to feed the legacy
   *  `draws` / `draws_caused` payload fields. */
  drawCounts: number[];
}

/**
 * Pull the discard-then-draw cost/benefit out of a block's child lines —
 * the shape behind Ultra Ball ("discarded 2 cards" → "drew Mega Greninja
 * ex") and abilities like N's Zoroark ex's Trade.
 *
 * Card names arrive two ways and both have to be handled: a single card is
 * named inline on the dash ("discarded N's Zekrom."), while multiples are
 * summarised on the dash ("discarded 2 cards.") with the names on bullet
 * children *underneath* it. Bullets carry no marker saying which dash they
 * belong to, so the only thing tying them together is document order —
 * hence the `pending` cursor tracking the nearest dash above.
 */
function extractDiscardDraw(block: Block): DiscardDraw {
  const discarded: string[] = [];
  const drawn: string[] = [];
  const drawCounts: number[] = [];
  let drawnCount = 0;
  let pending: "discard" | "draw" | null = null;

  for (const child of block.children) {
    if (child.kind === "bullet") {
      if (pending === "discard") discarded.push(...splitCardList(child.text));
      else if (pending === "draw") drawn.push(...splitCardList(child.text));
      continue;
    }

    const t = normalizeQuotes(child.text);
    // Any other dash line (a shuffle, a switch) ends the previous one's
    // bullet run, so a later unrelated list can't be misattributed.
    pending = null;

    // Counted forms first: "discarded 2 cards." would otherwise be swallowed
    // by the single-card pattern with "2 cards" as the card's name.
    if (/^(.+?) discarded (\d+) cards\.$/.test(t)) {
      pending = "discard";
      continue;
    }
    const disc = t.match(/^(.+?) discarded (.+?)\.$/);
    if (disc) {
      discarded.push(disc[2]);
      continue;
    }

    const drewN = t.match(/^(.+?) drew (\d+) cards\.$/);
    if (drewN) {
      drawCounts.push(Number(drewN[2]));
      drawnCount += Number(drewN[2]);
      pending = "draw";
      continue;
    }
    // "drew a card." names no card — count it without inventing "a card"
    // as a name, which the general pattern below would otherwise do.
    if (/^(.+?) drew a card\.$/.test(t)) {
      drawnCount += 1;
      continue;
    }
    const drew = t.match(/^(.+?) drew (.+?)\.$/);
    if (drew) {
      drawn.push(drew[2]);
      drawnCount += 1;
    }
  }

  return { discarded, drawn, drawnCount, drawCounts };
}

export interface MulliganReveal {
  /** The mulligan's 1-indexed number for this player — "Mulligan 1",
   *  "Mulligan 2", etc. — as printed in the log, not a position in this
   *  action's own array (mulligan_total's array can start at 2). */
  index: number;
  cards: string[];
}

/**
 * Pulls each "Cards revealed from Mulligan N" dash's own bullet list into
 * its own group, rather than flattening every bullet in the block together
 * — the same document-order trap extractDiscardDraw guards against. It
 * matters here because a single "took 3 mulligans." block carries TWO
 * dash+bullet pairs (mulligan 2's hand, then mulligan 3's), and collapsing
 * them would present a mulliganing player's two separate 7-card hands as
 * one 14-card hand.
 */
function extractMulliganReveals(block: Block): MulliganReveal[] {
  const out: MulliganReveal[] = [];
  let current: MulliganReveal | null = null;
  for (const child of block.children) {
    if (child.kind === "bullet") {
      current?.cards.push(...splitCardList(child.text));
      continue;
    }
    const m = normalizeQuotes(child.text).match(/^Cards revealed from Mulligan (\d+)$/);
    current = m ? { index: Number(m[1]), cards: [] } : null;
    if (current) out.push(current);
  }
  return out;
}

/** Build a payload-augmented ParsedAction. */
function action(
  action_type: ParsedAction["action_type"],
  actor_handle: string | null,
  raw_text: string,
  payload: Record<string, unknown> = {},
): ParsedAction {
  return { action_type, actor: null, actor_handle, raw_text, payload };
}

/* ─── Pattern table ───────────────────────────────────────────── */
//
// Patterns are listed roughly in order of specificity. More specific
// patterns must come before more general ones (e.g., "drew N cards for
// the opening hand" before "drew N cards").

type PatternHandler = (
  match: RegExpMatchArray,
  block: Block,
) => ParsedAction | ParsedAction[] | null;

interface Pattern {
  re: RegExp;
  handle: PatternHandler;
}

const PATTERNS: Pattern[] = [
  // ── Setup ────────────────────────────────────────────────────
  {
    re: /^(.+?) chose (tails|heads) for the opening coin flip\.$/,
    handle: (m, b) => action("coin_flip", m[1], b.text, { choice: m[2] }),
  },
  {
    re: /^(.+?) won the coin toss\.$/,
    handle: (m, b) => action("coin_toss_won", m[1], b.text),
  },
  {
    re: /^(.+?) decided to go (first|second)\.$/,
    handle: (m, b) => action("chose_first", m[1], b.text, { order: m[2] }),
  },
  {
    re: /^(.+?) drew (\d+) cards for the opening hand\.$/,
    handle: (m, b) =>
      action("opening_hand", m[1], b.text, {
        count: Number(m[2]),
        revealed_cards: collectRevealedCards(b),
      }),
  },
  {
    re: /^(.+?) took a mulligan\.$/,
    handle: (m, b) =>
      action("mulligan", m[1], b.text, {
        revealed_cards: collectRevealedCards(b),
        mulligan_reveals: extractMulliganReveals(b),
      }),
  },
  {
    re: /^(.+?) took (\d+) mulligans\.$/,
    handle: (m, b) =>
      action("mulligan_total", m[1], b.text, {
        total: Number(m[2]),
        revealed_cards: collectRevealedCards(b),
        mulligan_reveals: extractMulliganReveals(b),
      }),
  },
  {
    re: /^(.+?) drew (\d+) more cards? because (.+?) took at least 1 mulligan\.$/,
    handle: (m, b) =>
      action("mulligan_bonus_draw", m[1], b.text, {
        count: Number(m[2]),
        because_of: m[3],
        revealed_cards: collectRevealedCards(b),
      }),
  },

  // ── Plays / placements ───────────────────────────────────────
  {
    re: /^(.+?) played (.+?) to the Active Spot\.$/,
    handle: (m, b) => action("play_to_active", m[1], b.text, { card: m[2] }),
  },
  {
    re: /^(.+?) played (.+?) to the Bench\.$/,
    handle: (m, b) => action("play_to_bench", m[1], b.text, { card: m[2] }),
  },
  {
    re: /^(.+?) played (.+?) to the Stadium spot\.$/,
    handle: (m, b) => {
      const replaced: string[] = [];
      for (const c of b.children) {
        const dm = c.text.match(/^(.+?) discarded (.+?)\.$/);
        if (dm) replaced.push(dm[2]);
      }
      return action("play_stadium", m[1], b.text, {
        card: m[2],
        ...(replaced.length ? { replaced_stadium: replaced } : {}),
      });
    },
  },

  // ── Energy attach ────────────────────────────────────────────
  {
    re: /^(.+?) attached (.+?) to (.+?) in the Active Spot\.$/,
    handle: (m, b) =>
      action("attach_energy", m[1], b.text, {
        energy: m[2],
        target: m[3],
        location: "active",
      }),
  },
  {
    re: /^(.+?) attached (.+?) to (.+?) on the Bench\.$/,
    handle: (m, b) =>
      action("attach_energy", m[1], b.text, {
        energy: m[2],
        target: m[3],
        location: "bench",
      }),
  },

  // ── Evolve ───────────────────────────────────────────────────
  {
    re: /^(.+?) evolved (.+?) to (.+?) in the Active Spot\.$/,
    handle: (m, b) =>
      action("evolve", m[1], b.text, {
        from: m[2],
        to: m[3],
        location: "active",
      }),
  },
  {
    re: /^(.+?) evolved (.+?) to (.+?) on the Bench\.$/,
    handle: (m, b) =>
      action("evolve", m[1], b.text, {
        from: m[2],
        to: m[3],
        location: "bench",
      }),
  },

  // ── Retreat ──────────────────────────────────────────────────
  {
    re: /^(.+?) retreated (.+?) to the Bench\.$/,
    handle: (m, b) => {
      const discardedEnergies: string[] = [];
      for (const c of b.children) {
        const em = c.text.match(/^(.+?) was discarded from (.+?)'s (.+?)\.$/);
        if (em) discardedEnergies.push(em[1]);
      }
      return action("retreat", m[1], b.text, {
        pokemon: m[2],
        discarded_energies: discardedEnergies,
      });
    },
  },

  // ── Switch (Active promoted, often follows retreat or KO) ────
  {
    re: /^(.+?)'s (.+?) is now in the Active Spot\.$/,
    handle: (m, b) =>
      action("switch_active", m[1], b.text, { pokemon: m[2] }),
  },

  // ── Turn boundaries ──────────────────────────────────────────
  {
    re: /^(.+?) ended their turn\.$/,
    handle: (m, b) => action("turn_end", m[1], b.text),
  },

  // ── Attacks ──────────────────────────────────────────────────
  // Damage line may end with: "<Pokemon> took N more damage because of <Type> Weakness."
  {
    re: /^(.+?)'s (.+?) used (.+?) on (.+?)'s (.+?) for (\d+) damage\.(?:\s+(.+?)'s (.+?) took (\d+) more damage because of (.+?) Weakness\.)?$/,
    handle: (m, b) => {
      const damageBreakdown: string[] = [];
      const choices: string[] = [];
      const splashDamage: Array<{ pokemon: string; damage: number; handle: string }> = [];
      const discardsFromAttacker: string[] = [];

      for (const c of b.children) {
        const t = c.text;
        if (/^Damage breakdown:/i.test(t)) {
          // Followed by bullet items; collect them too.
          continue;
        }
        const choice = t.match(/^(?:.+? )?chose (.+)$/);
        if (choice) {
          choices.push(choice[1].replace(/\.$/, ""));
          continue;
        }
        const splash = t.match(/^(.+?)'s (.+?) took (\d+) damage\.$/);
        if (splash) {
          splashDamage.push({
            handle: splash[1],
            pokemon: splash[2],
            damage: Number(splash[3]),
          });
          continue;
        }
        const disc = t.match(/^(\d+) cards were discarded from (.+?)'s (.+?)\.$/);
        if (disc) {
          // Capture the count; the cards themselves come via bullets that
          // were already merged here when iterating children, but for the
          // attacker discard we keep them in the payload below via
          // collectRevealedCards if needed.
          discardsFromAttacker.push(`${disc[1]}x from ${disc[2]}'s ${disc[3]}`);
          continue;
        }
      }

      const revealed = collectRevealedCards(b);

      return action("attack", m[1], b.text, {
        attacker: m[2],
        attack_name: m[3],
        defender_handle: m[4],
        defender: m[5],
        damage: Number(m[6]),
        weakness_bonus: m[9] ? Number(m[9]) : null,
        weakness_target: m[8] || null,
        weakness_type: m[10] || null,
        damage_breakdown_raw: damageBreakdown,
        choices,
        splash_damage: splashDamage,
        discards_from_attacker_summary: discardsFromAttacker,
        revealed_cards_in_block: revealed,
      });
    },
  },

  // ── Ability used (no target / no damage) ─────────────────────
  {
    re: /^(.+?)'s (.+?) used (.+?)\.$/,
    handle: (m, b) => {
      const revealed = collectRevealedCards(b);
      const dd = extractDiscardDraw(b);
      return action("ability_used", m[1], b.text, {
        source: m[2],
        ability_name: m[3],
        revealed_cards: revealed,
        // `discards` / `draws` predate extractDiscardDraw and nothing in
        // this repo reads them, but they ship in persisted match_actions
        // payloads, so they stay. Deriving them from the same result keeps
        // them from drifting out of step with the canonical fields below.
        discards: dd.discarded,
        draws: dd.drawCounts,
        discarded_cards: dd.discarded,
        drawn_cards: dd.drawn,
        drawn_count: dd.drawnCount,
      });
    },
  },

  // ── KO & prizes ──────────────────────────────────────────────
  {
    re: /^(.+?)'s (.+?) was Knocked Out!$/,
    handle: (m, b) => action("knock_out", m[1], b.text, { pokemon: m[2] }),
  },
  {
    re: /^(.+?) took a Prize card\.$/,
    handle: (m, b) => action("prize_taken", m[1], b.text, { count: 1 }),
  },
  {
    re: /^(.+?) took (\d+) Prize cards\.$/,
    handle: (m, b) =>
      action("prize_taken", m[1], b.text, { count: Number(m[2]) }),
  },

  // Prize-taken often has a follow-up line: "<card> was added to <handle>'s hand."
  // Treat that as its own action (handled by a separate pattern below).
  {
    re: /^A card was added to (.+?)'s hand\.$/,
    handle: (m, b) => action("add_to_hand", m[1], b.text, { hidden: true }),
  },
  {
    re: /^(.+?) was added to (.+?)'s hand\.$/,
    handle: (m, b) =>
      action("add_to_hand", m[2], b.text, { card: m[1], hidden: false }),
  },

  // ── Card flow ────────────────────────────────────────────────
  {
    re: /^(.+?) drew a card\.$/,
    handle: (m, b) => action("draw", m[1], b.text, { count: 1 }),
  },
  {
    re: /^(.+?) drew (\d+) cards\.$/,
    handle: (m, b) =>
      action("draw", m[1], b.text, {
        count: Number(m[2]),
        revealed_cards: collectRevealedCards(b),
      }),
  },
  {
    re: /^(.+?) drew (.+?)\.$/,
    handle: (m, b) =>
      action("draw", m[1], b.text, { count: 1, card: m[2] }),
  },
  {
    re: /^(.+?) shuffled (\d+) cards into their deck\.$/,
    handle: (m, b) =>
      action("shuffle", m[1], b.text, {
        cards_shuffled_in: Number(m[2]),
        revealed_cards: collectRevealedCards(b),
      }),
  },
  {
    re: /^(.+?) shuffled their deck\.$/,
    handle: (m, b) => action("shuffle", m[1], b.text),
  },
  {
    re: /^(.+?) discarded (\d+) cards\.$/,
    handle: (m, b) =>
      action("discard", m[1], b.text, {
        count: Number(m[2]),
        revealed_cards: collectRevealedCards(b),
      }),
  },
  {
    re: /^(.+?) discarded (.+?)\.$/,
    handle: (m, b) => action("discard", m[1], b.text, { card: m[2] }),
  },
  {
    re: /^(.+?) moved (.+?)'s (.+?) to their hand\.$/,
    handle: (m, b) =>
      action("move_to_hand", m[1], b.text, {
        owner: m[2],
        card: m[3],
      }),
  },

  // ── Conditions & checkup damage ──────────────────────────────
  {
    re: /^(.+?)'s (.+?) is now (Poisoned|Burned|Asleep|Confused|Paralyzed)\.$/,
    handle: (m, b) =>
      action("condition_applied", m[1], b.text, {
        pokemon: m[2],
        condition: m[3] as SpecialCondition,
      }),
  },
  {
    re: /^(\d+) damage counter(?:s)? (?:was|were) placed on (.+?)'s (.+?) for the Special Condition (Poisoned|Burned)\.$/,
    handle: (m, b) =>
      action("damage_counter_placed", m[2], b.text, {
        counters: Number(m[1]),
        pokemon: m[3],
        from_condition: m[4],
      }),
  },

  // ── Passive card/effect activation (Stadium triggers, Tool triggers) ─
  {
    re: /^(.+?) was activated\.$/,
    handle: (m, b) => action("effect_activated", null, b.text, { card: m[1] }),
  },

  // ── Discards initiated by board state (retreat energy, KO discard) ─
  {
    re: /^(.+?) was discarded from (.+?)'s (.+?)\.$/,
    handle: (m, b) =>
      action("discard_from_pokemon", m[2], b.text, {
        owner: m[2],
        pokemon: m[3],
        card: m[1],
      }),
  },

  // ── Played a non-Pokemon card (supporter / item / tool) ──────
  // This is intentionally one of the last patterns: by the time we get
  // here we've already matched "played X to the Bench/Active/Stadium"
  // and "played X to the Active Spot". Anything else "X played Y." is
  // a supporter or item — we cannot reliably distinguish without a card
  // catalog. Marked play_item; the post-processor can re-tag using the
  // card index later.
  {
    re: /^(.+?) played (.+?)\.$/,
    handle: (m, b) => {
      const revealed = collectRevealedCards(b);
      const dd = extractDiscardDraw(b);
      const switches: Array<{ from: string; to: string; handle: string }> = [];
      for (const c of b.children) {
        const sw = c.text.match(/^(.+?)'s (.+?) was switched with (.+?)'s (.+?) to become the Active Pok[eé]mon\.$/);
        if (sw) switches.push({ handle: sw[1], from: sw[2], to: sw[4] });
      }
      return action("play_item", m[1], b.text, {
        card: m[2],
        revealed_cards: revealed,
        // Legacy field, kept for persisted payloads — see ability_used.
        draws_caused: dd.drawCounts,
        discarded_cards: dd.discarded,
        drawn_cards: dd.drawn,
        drawn_count: dd.drawnCount,
        forced_switches: switches,
      });
    },
  },

  // ── Game end ─────────────────────────────────────────────────
  {
    re: /^All Prize cards taken\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[1], b.text, { reason: "prizes", winner: m[1] }),
  },
  {
    re: /^Knocked Out all your opponent's Pok[eé]mon in play and took all your Prize cards\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[1], b.text, { reason: "prizes", winner: m[1] }),
  },
  {
    re: /^Opponent Knocked Out all your Pok[eé]mon in play and took all their Prize cards\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[1], b.text, { reason: "prizes", winner: m[1] }),
  },
  {
    re: /^(.+?) had no Pok[eé]mon left\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[2], b.text, {
        reason: "no_active",
        winner: m[2],
        loser: m[1],
      }),
  },
  {
    re: /^(.+?) decked out\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[2], b.text, {
        reason: "deck_out",
        winner: m[2],
        loser: m[1],
      }),
  },
  {
    re: /^(.+?) conceded\. (.+?) wins\.$/,
    handle: (m, b) =>
      action("game_end", m[2], b.text, {
        reason: "concede",
        winner: m[2],
        loser: m[1],
      }),
  },
];

/* ─── Block → actions ─────────────────────────────────────────── */

/**
 * Some child (dash) lines carry meaningful state changes that deserve
 * their own action entries — conditions inflicted by trainer effects,
 * energy attaches inside Janine's Secret Art / N's PP Up, checkup damage
 * counter placement. Extract them so the action stream is complete even
 * when the parent block is something generic like "played Janine's
 * Secret Art."
 */
function extractChildActions(block: Block): ParsedAction[] {
  const out: ParsedAction[] = [];
  // Nearest "drew ... and played them to the Bench" dash above, waiting for
  // the bullet that names the cards. Same document-order pairing as
  // extractDiscardDraw — bullets carry no marker saying which dash owns them.
  let pendingBench: { actor: string; raw: string } | null = null;

  for (const child of block.children) {
    if (child.kind === "bullet") {
      if (pendingBench) {
        for (const name of splitCardList(child.text)) {
          out.push(action("play_to_bench", pendingBench.actor, pendingBench.raw, { card: name }));
        }
        pendingBench = null;
      }
      continue;
    }
    const t = normalizeQuotes(child.text);
    // Any other dash ends the previous one's bullet run, so an unrelated
    // later list can't be misattributed to it.
    pendingBench = null;

    // Pokémon fetched from the deck straight onto the Bench — Buddy-Buddy
    // Poffin, a Telepathic Psychic Energy trigger.
    //
    // These were dropped entirely, and the consequences showed up much later
    // and looked like something else: the engine never put the Pokémon on the
    // bench, so when one of them was promoted the switch_active handler
    // conjured it out of nowhere, and a viewer saw a card appear in the
    // Active Spot having never been anywhere. Every name is right there in
    // the bullet underneath.
    const benchMulti = t.match(
      /^(.+?) drew (\d+) cards? and played them to the Bench\.$/,
    );
    if (benchMulti) {
      pendingBench = { actor: benchMulti[1], raw: child.raw };
      continue;
    }
    const benchOne = t.match(/^(.+?) drew (.+?) and played it to the Bench\.$/);
    if (benchOne) {
      out.push(action("play_to_bench", benchOne[1], child.raw, { card: benchOne[2] }));
      continue;
    }

    const cond = t.match(
      /^(.+?)'s (.+?) is now (Poisoned|Burned|Asleep|Confused|Paralyzed)\.$/,
    );
    if (cond) {
      out.push(
        action("condition_applied", cond[1], child.raw, {
          pokemon: cond[2],
          condition: cond[3],
        }),
      );
      continue;
    }

    const attachActive = t.match(
      /^(.+?) attached (.+?) to (.+?) in the Active Spot\.$/,
    );
    if (attachActive) {
      out.push(
        action("attach_energy", attachActive[1], child.raw, {
          energy: attachActive[2],
          target: attachActive[3],
          location: "active",
          via_effect: true,
        }),
      );
      continue;
    }

    const attachBench = t.match(
      /^(.+?) attached (.+?) to (.+?) on the Bench\.$/,
    );
    if (attachBench) {
      out.push(
        action("attach_energy", attachBench[1], child.raw, {
          energy: attachBench[2],
          target: attachBench[3],
          location: "bench",
          via_effect: true,
        }),
      );
      continue;
    }

    const counter = t.match(
      /^(\d+) damage counter(?:s)? (?:was|were) placed on (.+?)'s (.+?) for the Special Condition (Poisoned|Burned)\.$/,
    );
    if (counter) {
      out.push(
        action("damage_counter_placed", counter[2], child.raw, {
          counters: Number(counter[1]),
          pokemon: counter[3],
          from_condition: counter[4],
        }),
      );
      continue;
    }

    // Damage counters moved between Pokémon — Munkidori's Adrena-Brain.
    //
    // Both possessives are unreliable, exactly as for the placement lines
    // below: Adrena-Brain moves damage from your own Pokémon onto the
    // opponent's, and the log stamps both ends with the same handle. Only
    // the names are trustworthy, so they are all the payload carries.
    const moved = t.match(
      /^(.+?) moved (\d+) damage counters? from (.+?)'s (.+?) to (.+?)'s (.+?)\.$/,
    );
    if (moved) {
      out.push(
        action("damage_counters_moved", moved[1], child.raw, {
          counters: Number(moved[2]),
          from: moved[4],
          to: moved[6],
        }),
      );
      continue;
    }
  }

  // Effect-driven damage counters, gathered across the whole block into ONE
  // action rather than one per line.
  //
  // Froslass's Freezing Shroud puts a counter on every Pokémon in play with
  // an ability — both players' — and TCG Live writes one child line each:
  //
  //   Qjiaaap's Froslass used Freezing Shroud.
  //   - a11father put a damage counter on Qjiaaap's N's Zoroark ex.
  //
  // Neither handle on those lines can be trusted. The leading actor flips
  // between checkups for the same Froslass, and the possessive is stamped
  // with one player's name for every target including the opponent's — the
  // N's Zoroark ex above is a11father's. What IS reliable is the set of
  // names, so the whole activation becomes a single action listing them and
  // the engine resolves them together against both boards. That also stops
  // the replay from treating one ability as six separate events.
  const placements = block.children.flatMap((child) => {
    if (child.kind !== "dash") return [];
    const m = normalizeQuotes(child.text).match(
      /^(.+?) put (?:a|(\d+)) damage counters? on (.+?)'s (.+?)\.$/,
    );
    return m ? [{ actor: m[1], count: Number(m[2] ?? 1), name: m[4], raw: child.raw }] : [];
  });
  if (placements.length > 0) {
    out.push(
      action("damage_counters_placed", placements[0].actor, block.text, {
        // One entry per line, duplicates included: three "Munkidori" lines
        // mean three different Munkidori in play, not one hit three times.
        targets: placements.map((p) => p.name),
        counters: placements.map((p) => p.count),
      }),
    );
  }
  return out;
}

function parseBlock(block: Block): { actions: ParsedAction[]; unmatched: boolean } {
  const text = normalizeQuotes(block.text);
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const result = p.handle(m, { ...block, text });
      if (!result) continue;
      const primary = Array.isArray(result) ? result : [result];
      return {
        actions: [...primary, ...extractChildActions(block)],
        unmatched: false,
      };
    }
  }
  return {
    actions: [
      action("unknown", null, block.text),
      ...extractChildActions(block),
    ],
    unmatched: true,
  };
}

/* ─── Main entry ──────────────────────────────────────────────── */

export function parseBattleLog(raw: string): BattleLogParseResult {
  const sections: Section[] = tokenize(raw);

  const actions: ParsedAction[] = [];
  const turns: ParsedTurn[] = [];
  const unmatched: string[] = [];
  const handleSeen: string[] = [];
  const cardIds: Record<string, string> = {};

  function noteHandle(h: string | null) {
    if (!h) return;
    if (!handleSeen.includes(h)) handleSeen.push(h);
  }

  // Per-player turn counters keyed by raw handle.
  const turnCountByHandle = new Map<string, number>();

  let turnNumber = 0;

  for (const section of sections) {
    if (section.kind === "other") continue;

    turnNumber += 1;
    const phase =
      section.kind === "setup"
        ? "setup"
        : section.kind === "checkup"
        ? "checkup"
        : "turn";

    let playerTurnNumber: number | null = null;
    if (section.kind === "turn" && section.handle) {
      const prev = turnCountByHandle.get(section.handle) ?? 0;
      playerTurnNumber = prev + 1;
      turnCountByHandle.set(section.handle, playerTurnNumber);
    }

    const turnAt = actions.length;

    // For "turn" sections, synthesize an explicit turn_start at the top so
    // the action stream is self-describing without leaning on the turns
    // table. (Helpful for downstream analytics queries.)
    if (section.kind === "turn" && section.handle) {
      actions.push(
        action("turn_start", section.handle, section.header ?? `${section.handle}'s Turn`, {
          phase,
          turn_number: turnNumber,
          player_turn_number: playerTurnNumber,
        }),
      );
      noteHandle(section.handle);
    }

    for (const block of section.blocks) {
      const result = parseBlock(block);
      for (const a of result.actions) {
        stripActionCardIds(a, cardIds);
        actions.push(a);
        noteHandle(a.actor_handle);
        // Game-end winner handle is in payload, also worth tracking.
        if (a.action_type === "game_end" && typeof a.payload.winner === "string") {
          noteHandle(a.payload.winner);
        }
      }
      if (result.unmatched) unmatched.push(stripCardIds(block.text));
    }

    const turnEnd = actions.length;

    turns.push({
      turn_number: turnNumber,
      player_turn_number: playerTurnNumber,
      actor:
        section.kind === "checkup" || section.kind === "setup" ? "system" : "player", // placeholder, normalized later
      actor_handle: section.handle,
      phase,
      action_indices: Array.from({ length: turnEnd - turnAt }, (_, i) => turnAt + i),
    });
  }

  return {
    handles: handleSeen,
    player_handle: null,
    opponent_handle: null,
    actions,
    turns,
    unmatched,
    cardIds,
    parser_version: PARSER_VERSION,
  };
}
