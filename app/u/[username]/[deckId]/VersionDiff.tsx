"use client";

import { useEffect, useState } from "react";
import { diffDeckLists, type DeckDiff, type DeckSection, type DiffEntry } from "@/lib/deckDiff";

/**
 * GitHub-style card diff between two versions of a deck. Fetches each
 * version's full deck list from the versions API, diffs by card name
 * within section, and renders +green / −red / amber-count rows.
 */

interface VersionRef {
  id: string;
  label: string;
}

interface Props {
  deckId: string;
  /** Older version (diff base). */
  from: VersionRef;
  /** Newer version. */
  to: VersionRef;
  onClose: () => void;
}

const SECTION_LABEL: Record<DeckSection, string> = {
  pokemon: "Pokémon",
  trainer: "Trainer",
  energy: "Energy",
};
const SECTION_ORDER: DeckSection[] = ["pokemon", "trainer", "energy"];

function DiffRow({ entry }: { entry: DiffEntry }) {
  const delta = entry.toQty - entry.fromQty;
  if (entry.fromQty === 0) {
    return (
      <li className="flex items-center gap-2 rounded-md bg-[#5baa4f]/10 px-2.5 py-1.5">
        <span className="w-9 shrink-0 text-xs font-mono font-semibold text-[#3d7a34]">
          +{entry.toQty}
        </span>
        <span className="text-sm text-text-primary truncate">{entry.name}</span>
      </li>
    );
  }
  if (entry.toQty === 0) {
    return (
      <li className="flex items-center gap-2 rounded-md bg-accent/10 px-2.5 py-1.5">
        <span className="w-9 shrink-0 text-xs font-mono font-semibold text-accent">
          −{entry.fromQty}
        </span>
        <span className="text-sm text-text-primary truncate line-through decoration-text-muted/60">
          {entry.name}
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 rounded-md bg-black/[0.04] px-2.5 py-1.5">
      <span className="w-9 shrink-0 text-xs font-mono font-semibold text-text-secondary">
        {delta > 0 ? `+${delta}` : `${delta}`}
      </span>
      <span className="text-sm text-text-primary truncate">{entry.name}</span>
      <span className="ml-auto shrink-0 text-xs font-mono text-text-muted">
        {entry.fromQty} → {entry.toQty}
      </span>
    </li>
  );
}

export default function VersionDiff({ deckId, from, to, onClose }: Props) {
  const [diff, setDiff] = useState<DeckDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);

    async function fetchList(versionId: string): Promise<string> {
      const res = await fetch(`/api/saved-decks/${deckId}/versions/${versionId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load version.");
      return data.version.deck_list as string;
    }

    Promise.all([fetchList(from.id), fetchList(to.id)])
      .then(([fromList, toList]) => {
        if (!cancelled) setDiff(diffDeckLists(fromList, toList));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to compare versions.");
      });

    return () => {
      cancelled = true;
    };
  }, [deckId, from.id, to.id]);

  const entriesBySection = (section: DeckSection): DiffEntry[] =>
    diff
      ? [...diff.added, ...diff.removed, ...diff.changed]
          .filter((e) => e.section === section)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return (
    <div className="mt-3 rounded-xl border border-black/8 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {from.label}{" "}
          <span className="normal-case font-medium tracking-normal text-text-muted">→</span>{" "}
          {to.label}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comparison"
          className="rounded-full p-1 text-text-muted hover:bg-black/5 hover:text-text-primary transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}

      {!error && !diff && (
        <p className="text-sm text-text-muted animate-pulse">Comparing…</p>
      )}

      {diff && diff.empty && (
        <p className="text-sm text-text-secondary">
          No card changes between these versions.
        </p>
      )}

      {diff && !diff.empty && (
        <div className="flex flex-col gap-4">
          {SECTION_ORDER.map((section) => {
            const entries = entriesBySection(section);
            if (entries.length === 0) return null;
            return (
              <div key={section}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  {SECTION_LABEL[section]}
                </h4>
                <ul className="flex flex-col gap-1">
                  {entries.map((e) => (
                    <DiffRow key={`${e.section}|${e.name}`} entry={e} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
