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
  // Best-of-3 lives here so its capsule toggle can sit in the tab strip and
  // drive the manual MatchForm below (controlled mode).
  const [bestOf3, setBestOf3] = useState(false);

  return (
    <div>
      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-border mb-3">
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

        {/* Single Match / Best of 3 capsule toggle — manual entry only */}
        {tab === "manual" && (
          <button
            type="button"
            onClick={() => setBestOf3((v) => !v)}
            aria-pressed={bestOf3}
            title="Switch between a single match and a best-of-3 round"
            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
              bestOf3
                ? "border-transparent bg-accent text-white hover:bg-accent-light"
                : "border-black/10 bg-white text-text-secondary hover:bg-surface"
            }`}
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-9L21 7.5m0 0L16.5 3M21 7.5H7.5" />
            </svg>
            {bestOf3 ? "Best of 3" : "Single Match"}
          </button>
        )}
      </div>

      {tab === "manual" ? (
        <MatchForm
          onSubmit={onSubmitManual}
          onCancel={onCancel}
          bestOf3={bestOf3}
          onBestOf3Change={setBestOf3}
        />
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
