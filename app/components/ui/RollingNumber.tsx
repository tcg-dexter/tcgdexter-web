"use client";

import { useEffect, useState } from "react";

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
 * SSR renders the final value, and so does the first client render — the
 * roll only starts in an effect, so there is no hydration mismatch and no
 * intermediate glyph is ever sent down the wire.
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

const ROLL_MS = 620;
const COLUMN_STAGGER_MS = 55;
/** Easing with a long tail — the column decelerates into its glyph rather
 *  than stopping dead, which is what sells the mechanical settle. */
const ROLL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

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
  const hasDigits = chars.some((c) => c >= "0" && c <= "9");

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

    // Longest column finishes last; swap back to plain text once it has,
    // so the settled tile is ordinary selectable text rather than a stack
    // of clipped boxes.
    const total = ROLL_MS + COLUMN_STAGGER_MS * chars.length + 60;
    const done = setTimeout(() => setPhase("idle"), total);
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
      <span aria-hidden="true">
        {chars.map((ch, i) => {
          if (ch < "0" || ch > "9") {
            return <span key={i}>{ch}</span>;
          }
          digitIndex += 1;
          const length = stripLength(digitIndex);
          const strip = buildStrip(Number(ch), length);
          const offsetPct = phase === "running" ? -(length - 1) * 100 : 0;
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
                        ? `transform ${ROLL_MS}ms ${ROLL_EASING} ${digitIndex * COLUMN_STAGGER_MS}ms`
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
