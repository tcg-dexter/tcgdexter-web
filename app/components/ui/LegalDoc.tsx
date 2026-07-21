import type { ReactNode } from "react";

/**
 * Shared layout for /privacy and /terms — title + "last updated" date over
 * a column of LegalSection blocks. Mirrors the standard page-wrapper
 * padding used across the app's top-level routes (e.g. /settings).
 */
export default function LegalDoc({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <h1 className="text-3xl font-semibold tracking-tight text-text-primary">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">Last updated {lastUpdated}</p>
      <div className="mt-8 space-y-8">{children}</div>
    </main>
  );
}

/** One heading + body block. Paragraph/list styling is set once here and
 *  inherited by plain <p>/<ul> children, so the page files can stay
 *  semantic HTML without repeating classes on every element. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-2">{heading}</h2>
      <div className="space-y-3 text-sm text-text-secondary leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-accent [&_a]:hover:underline">
        {children}
      </div>
    </section>
  );
}
