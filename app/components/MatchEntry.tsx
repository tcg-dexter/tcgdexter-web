"use client";

import { useLayoutEffect, useRef, useState } from "react";
import MatchForm, { type MatchFormData } from "./MatchForm";
import BattleLogImportTab from "./BattleLogImportTab";

interface Props {
  savedDeckId: string;
  /** Manual-entry submit handler — same shape MatchForm has always used. */
  onSubmitManual: (data: MatchFormData) => Promise<void>;
  /** Called when an import completes successfully. Parent should refresh. */
  onImported: () => void;
  onCancel: () => void;
}

type Tab = "single" | "bo3" | "import";

const TABS: { id: Tab; label: string }[] = [
  { id: "single", label: "Single" },
  { id: "bo3", label: "Best of 3" },
  { id: "import", label: "TCG Live" },
];

/**
 * New-match entry surface with three tabs:
 *   • Single — MatchForm in single-game mode.
 *   • Best of 3 — MatchForm with the per-game pickers (bestOf3 controlled).
 *   • TCG Live — battle-log import.
 *
 * Single and Best of 3 share the same MatchForm instance (only the bestOf3
 * prop changes), so opponent details typed under one carry over to the other.
 * Editing existing matches still uses MatchForm directly with its own toggle.
 */
export default function MatchEntry({
  savedDeckId,
  onSubmitManual,
  onImported,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<Tab>("single");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    single: null,
    bo3: null,
    import: null,
  });
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  return (
    <div>
      {/* Tab strip */}
      <div className="relative flex gap-1 border-b border-border mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${
              tab === t.id
                ? "text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div
          className="absolute bottom-0 h-0.5 bg-accent transition-all duration-300"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </div>

      {tab === "import" ? (
        <BattleLogImportTab
          savedDeckId={savedDeckId}
          onSuccess={onImported}
          onCancel={onCancel}
        />
      ) : (
        <MatchForm
          onSubmit={onSubmitManual}
          onCancel={onCancel}
          bestOf3={tab === "bo3"}
          onBestOf3Change={(v) => setTab(v ? "bo3" : "single")}
        />
      )}
    </div>
  );
}
