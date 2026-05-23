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

type Tab = "manual" | "import";

/**
 * New-match entry surface with two tabs:
 *   • Manual — the current MatchForm UI.
 *   • Paste battle log — TCG Live battle-log import.
 *
 * Both tabs share the same outer container so the visual frame stays
 * consistent. Editing existing matches still uses MatchForm directly.
 */
export default function MatchEntry({
  savedDeckId,
  onSubmitManual,
  onImported,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<Tab>("manual");

  return (
    <div>
      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border mb-3">
        <button
          onClick={() => setTab("manual")}
          className={`px-3 py-2 text-xs font-semibold transition-colors -mb-px border-b-2 ${
            tab === "manual"
              ? "border-accent text-text-primary"
              : "border-transparent text-text-muted hover:text-text-secondary"
          }`}
        >
          Manual
        </button>
        <button
          onClick={() => setTab("import")}
          className={`px-3 py-2 text-xs font-semibold transition-colors -mb-px border-b-2 ${
            tab === "import"
              ? "border-accent text-text-primary"
              : "border-transparent text-text-muted hover:text-text-secondary"
          }`}
        >
          Paste battle log
        </button>
      </div>

      {tab === "manual" ? (
        <MatchForm onSubmit={onSubmitManual} onCancel={onCancel} />
      ) : (
        <BattleLogImportTab
          savedDeckId={savedDeckId}
          onSuccess={onImported}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}
