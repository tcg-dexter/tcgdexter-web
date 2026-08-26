/**
 * Single source of truth for the page-load entrance timing shared by two
 * otherwise-unrelated animations: the banner card fan (TeamCards.tsx,
 * MetaProfileHeader.tsx, driven by the `.dx-fan-card` CSS in globals.css)
 * and the split-flap stat-value roll (RollingNumber.tsx). Both surfaces
 * moved to importing these numbers rather than restating them so that
 * changing one changes the other — see FAN_TOTAL_MS below.
 */

/** Wait before the first card leaves the stack, so the rest of the page
 *  (banner, avatar, layout) gets a beat to settle before the fan draws
 *  the eye. Threaded into globals.css as the `--fan-start-delay` custom
 *  property (see TeamCards.tsx / MetaProfileHeader.tsx) — the `250ms`
 *  literal in that stylesheet is a defensive fallback for the property
 *  being unset, not a second definition of this number. */
export const FAN_START_DELAY_MS = 250;

/** Delay between one card leaving the stack and the next. */
export const FAN_STAGGER_MS = 75;

/** How long a single card's own fan-out motion takes, once it starts. */
export const FAN_DURATION_MS = 620;

/** Cards in a full fan. Both banners cap at 7 — TeamCards always renders
 *  exactly 7 slots, and the meta archetype header's own selection
 *  (`topCardsAcrossVariants(topFiveVariants, 7)`) caps there too — so 7
 *  is the real worst case for either surface, not an arbitrary round
 *  number. */
export const FAN_MAX_CARDS = 7;

/**
 * Elapsed time from page load to the moment the LAST card in a full fan
 * finishes settling: the start delay, plus the stagger accumulated across
 * every card after the first, plus that last card's own motion.
 *
 * RollingNumber imports this to pin its own animation so a stat's roll —
 * regardless of how many digits the value has — always finishes exactly
 * when the banner does, rather than merely at a value happening to match
 * the current numbers above. That's the "baked in" part: change
 * FAN_STAGGER_MS or FAN_START_DELAY_MS and both animations move together.
 */
export const FAN_TOTAL_MS =
  FAN_START_DELAY_MS + (FAN_MAX_CARDS - 1) * FAN_STAGGER_MS + FAN_DURATION_MS;
