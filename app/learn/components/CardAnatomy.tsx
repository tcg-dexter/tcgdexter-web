"use client";

import { useState } from "react";
import CardImage from "@/app/cards/CardImage";

export type AnatomyPart = {
  /** Short name of the region, e.g. "HP". */
  label: string;
  /** What it means and why it matters. */
  text: string;
  /** Pin position as a percentage of the card face, from the top-left. */
  x: number;
  y: number;
};

/**
 * A card with its regions pinned and numbered, wired to a numbered legend.
 *
 * The anatomy lessons used to list "seven things worth knowing" as prose
 * beside an unlabelled card image, leaving the reader to map each description
 * onto a region themselves. That split attention is exactly the load this
 * removes: hovering, tapping or tabbing to a pin highlights its legend row,
 * and hovering a legend row lights up its pin.
 *
 * Resolved image URLs are passed in by the server component wrapper
 * (`CardAnatomyBlock`) so the card index stays out of the client bundle.
 */
export default function CardAnatomy({
  src,
  fallbackSrcs,
  name,
  setName,
  number,
  caption,
  parts,
}: {
  src: string;
  fallbackSrcs: string[];
  name: string;
  setName: string;
  number: string;
  caption: string;
  parts: AnatomyPart[];
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <figure className="my-6 rounded-xl border border-border bg-surface-elevated p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
        {/* Card face with pins. */}
        <div className="relative mx-auto w-full max-w-[230px] shrink-0">
          <CardImage
            src={src}
            fallbackSrcs={fallbackSrcs}
            alt={name}
            name={name}
            setName={setName}
            number={number}
            className="rounded-lg w-full warm-shadow"
            loading="eager"
          />
          {parts.map((p, i) => {
            const on = active === i;
            return (
              <button
                key={i}
                type="button"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(on ? null : i)}
                aria-label={`${i + 1}. ${p.label}`}
                aria-describedby={`anatomy-part-${i}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-transform ${
                  on
                    ? "scale-125 border-white bg-accent text-white z-10"
                    : "border-white bg-black/75 text-white"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* Legend. */}
        <ol className="flex-1 space-y-2 min-w-0">
          {parts.map((p, i) => {
            const on = active === i;
            return (
              <li
                key={i}
                id={`anatomy-part-${i}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`flex gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                  on ? "bg-surface dark:bg-surface-2" : ""
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums ${
                    on ? "bg-accent text-white" : "bg-surface text-text-secondary dark:bg-surface-2"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-text-secondary min-w-0">
                  <strong className="text-text-primary font-semibold">
                    {p.label}
                  </strong>{" "}
                  — {p.text}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <figcaption className="mt-4 text-center text-xs text-text-muted">
        {caption} · Tap or hover a number to find it on the card.
      </figcaption>
    </figure>
  );
}
