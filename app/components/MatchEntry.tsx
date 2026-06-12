"use client";

import { useState } from "react";
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

  return (
    <div>
      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? "border-accent text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
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
