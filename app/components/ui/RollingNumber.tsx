"use client";

import { useEffect, useState } from "react";
import { FAN_DURATION_MS, FAN_STAGGER_MS, FAN_TOTAL_MS } from "@/lib/entranceTiming";

/**
 * Split-flap / departure-board entrance for a stat value. Each digit column
 * counts up through 0–9 and lands on its final glyph, columns settling
 * left to right — the web answer to SwiftUI's `.numeric` content
 * transition.
 *
 * Takes the ALREADY-FORMATTED display string, not a number, because the
 * values it animates aren't all plain integers: "1,234", "87%", "$12.50",
 * and the em dash the profile shows a visitor in place of an owner-only
 * stat all pass through here. Only digits roll; separators, symbols and
 * the dash are painted statically in place, and a value with no digits at
 * all renders as plain text with no animation to run.
 *
 * ── Why the markup is shaped the way it is ──
 * A rolling digit needs a clipping window exactly one line-box tall, and
 * "one line box" isn't a length this component can know — it depends on
 * the caller's font size and leading. So each column sizes itself from an
 * invisible copy of its own glyph and the moving strip is absolutely
 * positioned over that. The strip is a flex column of full-height cells,
 * which is what lets `height: 100%` resolve (a percentage height against
 * an auto-height block parent would not) and what makes `translateY` in
 * percent step exactly one glyph at a time. Centring each glyph in its
 * cell reproduces the half-leading a normal inline glyph gets, so nothing
 * shifts by a pixel when the roll finishes and the plain text comes back.
 *
 * The animated markup is a run of separate inline spans — one per
 * character — rather than one text node, which reintroduces a wrap risk
 * the plain text never had. Browsers give adjacent inline-block boxes a
 * soft line-break opportunity at their edges even with no whitespace
 * between them, which plain text (an unbroken run of characters) doesn't
 * get. A value like "42.7%" can sit well inside its tile as one line of
 * text yet still fold its "%" onto a second line the moment it's rendered
 * as separate spans — confirmed in a browser: the split markup wraps at a
 * width the same text renders on one line at. `whitespace-nowrap` on the
 * animated wrapper closes that off, so the two representations agree on
 * whether the value fits instead of only the plain one ever getting to
 * decide.
 *
 * SSR renders the final value, and so does the first client render — the
 * roll only starts in an effect, so there is no hydration mismatch and no
 * intermediate glyph is ever sent down the wire.
 *
 * ── Timing is pinned to the banner fan, not just similar to it ──
 * The whole roll — however many digits the value has — always finishes
 * exactly FAN_TOTAL_MS (lib/entranceTiming.ts) after it starts, the same
 * elapsed span the page's card fan takes from its own start delay through
 * its last card settling. That's a deliberate invariant, not a matching
 * pair of hardcoded numbers: change FAN_STAGGER_MS or FAN_START_DELAY_MS
 * and both animations move together.
 *
 * The LAST digit column is pinned to land at exactly FAN_TOTAL_MS; earlier
 * columns count backward from it in FAN_STAGGER_MS steps (clamped at 0),
 * so a five-digit value spreads its columns out while a single-digit value
 * — which has no earlier columns to space out — simply holds before
 * rolling and finishes at the same instant everything else would. Pinning
 * to the LAST column rather than starting the first one at 0 and letting
 * the total fall out of `digitCount * stagger` is what makes the total
 * hold regardless of how many digits a given stat happens to have.
 */

/** Cells in a column, including the landing glyph. Varied slightly per
 *  column so neighbouring digits don't spin in lockstep. */
function stripLength(columnIndex: number): number {
  return 11 + (columnIndex % 3) * 2;
}

/** Cells count UP to the target so the column reads as a counter rolling
 *  over, the way a real flap board does — never a random scramble. */
function buildStrip(target: number, length: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < length; j++) {
    out.push((((target - (length - 1 - j)) % 10) + 10) % 10);
  }
  return out;
}

// A single digit's own roll takes as long as one banner card's fan-out
// motion — reusing FAN_DURATION_MS rather than restating 620ms is what
// keeps the two in the same family, not just coincidentally equal today.
const ROLL_MS = FAN_DURATION_MS;
/** Easing with a long tail — the column decelerates into its glyph rather
 *  than stopping dead, which is what sells the mechanical settle. */
const ROLL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Delay for the digit column at `index` of `digitCount` total, counting
 * BACKWARD from the fixed end of the roll rather than forward from a
 * start at 0. That direction is what pins the last column to
 * `FAN_TOTAL_MS - ROLL_MS` (and therefore its finish to FAN_TOTAL_MS)
 * unconditionally — including digitCount === 1, where "first" and "last"
 * are the same column and there's nothing to space it out from. Clamped
 * at 0 so an unusually long value never asks for a negative delay; its
 * earliest columns just bunch up at the very start instead.
 */
function digitDelayMs(index: number, digitCount: number): number {
  const available = FAN_TOTAL_MS - ROLL_MS;
  return Math.max(0, available - (digitCount - 1 - index) * FAN_STAGGER_MS);
}

type Phase = "idle" | "start" | "running";

export default function RollingNumber({
  value,
  className,
}: {
  /** The formatted string to display. Digits roll; everything else doesn't. */
  value: string;
  /** Applied to the wrapper. Callers keep their own type styles. */
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  const chars = Array.from(value);
  const digitCount = chars.filter((c) => c >= "0" && c <= "9").length;
  const hasDigits = digitCount > 0;

  useEffect(() => {
    if (!hasDigits) return;
    // A stat board that flaps at someone who asked the OS to stop moving
    // things is exactly what the setting is for. Leave the final value on
    // screen and never enter the animated phases at all.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Paint the strip at its first cell before asking it to move: setting
    // both the start and end offsets in one commit would give the browser
    // nothing to transition from.
    setPhase("start");
    const raf = requestAnimationFrame(() => setPhase("running"));

    // The last column always lands at FAN_TOTAL_MS (see digitDelayMs); swap
    // back to plain text once it has, so the settled tile is ordinary
    // selectable text rather than a stack of clipped boxes. +60 is slack
    // for the transitionend commit, not a second timing source.
    const done = setTimeout(() => setPhase("idle"), FAN_TOTAL_MS + 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
      setPhase("idle");
    };
    // `value` is the real dependency — a refreshed stat should re-roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, hasDigits]);

  if (!hasDigits || phase === "idle") {
    return <span className={className}>{value}</span>;
  }

  // Column index counts digits only, so "1,234" staggers as three columns
  // (1 · 2 · 3 · 4) without the comma buying itself a slot in the sequence.
  let digitIndex = -1;

  return (
    <span className={className}>
      {/* The roll is decoration. Assistive tech gets the settled value the
          whole way through rather than a counter it would announce. */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="whitespace-nowrap">
        {chars.map((ch, i) => {
          if (ch < "0" || ch > "9") {
            return <span key={i}>{ch}</span>;
          }
          digitIndex += 1;
          const length = stripLength(digitIndex);
          const strip = buildStrip(Number(ch), length);
          const offsetPct = phase === "running" ? -(length - 1) * 100 : 0;
          const delayMs = digitDelayMs(digitIndex, digitCount);
          return (
            <span key={i} className="relative inline-block align-baseline">
              {/* Sizer — an invisible copy of the landing glyph. Gives the
                  column its exact width, its line-box height and the
                  baseline the neighbouring static characters sit on. */}
              <span className="invisible">{ch}</span>
              <span className="absolute inset-0 overflow-hidden">
                <span
                  className="flex h-full flex-col"
                  style={{
                    transform: `translateY(${offsetPct}%)`,
                    transition:
                      phase === "running"
                        ? `transform ${ROLL_MS}ms ${ROLL_EASING} ${delayMs}ms`
                        : undefined,
                  }}
                >
                  {strip.map((d, j) => (
                    <span
                      key={j}
                      className="flex h-full shrink-0 items-center justify-center"
                    >
                      {d}
                    </span>
                  ))}
                </span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
