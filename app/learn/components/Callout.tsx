import type { ReactNode } from "react";

export type CalloutKind = "rule" | "gotcha" | "tryit";

/**
 * Three jobs, three looks:
 *   rule   — a hard rule stated once, so it can be scanned back to later.
 *   gotcha — the mistake beginners actually make at this exact point.
 *   tryit  — do something in Dexter or at the table before reading on.
 *
 * Colours are literal Tailwind palette values rather than design tokens
 * because the token set carries a single (red) accent, and these need to read
 * as three distinct signals. Each pairs a light and a dark value explicitly —
 * the page renders under both themes.
 */
const STYLES: Record<CalloutKind, { label: string; wrap: string; chip: string }> = {
  rule: {
    label: "Rule",
    wrap: "border-l-4 border-l-sky-500 bg-sky-50 dark:bg-sky-950/40 dark:border-l-sky-400",
    chip: "text-sky-700 dark:text-sky-300",
  },
  gotcha: {
    label: "Watch out",
    wrap: "border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/40 dark:border-l-amber-400",
    chip: "text-amber-700 dark:text-amber-300",
  },
  tryit: {
    label: "Try it",
    wrap: "border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 dark:border-l-emerald-400",
    chip: "text-emerald-700 dark:text-emerald-300",
  },
};

export default function Callout({
  kind = "rule",
  title,
  children,
}: {
  kind?: CalloutKind;
  /** Overrides the default label ("Rule" / "Watch out" / "Try it"). */
  title?: string;
  children: ReactNode;
}) {
  const s = STYLES[kind] ?? STYLES.rule;
  return (
    <aside className={`my-5 rounded-r-lg px-4 py-3 ${s.wrap}`}>
      <p
        className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${s.chip}`}
      >
        {title ?? s.label}
      </p>
      <div className="text-sm leading-relaxed text-text-primary [&>p]:mb-2 [&>p:last-child]:mb-0">
        {children}
      </div>
    </aside>
  );
}
