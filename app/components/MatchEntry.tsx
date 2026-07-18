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
  /** Whether Cancel scrolls the page to top before closing. Defaults to true. */
  scrollToTopOnCancel?: boolean;
  /** Whether the entry surface is currently open/visible. Forwarded to
   *  MatchForm to gate its new-match autofocus — callers that keep this
   *  mounted-but-collapsed (grid card / pinned hero drawers) must pass
   *  `active={logOpen}` so the hidden form doesn't steal focus on page
   *  load. Defaults to true for callers that only mount it when open. */
  active?: boolean;
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
  scrollToTopOnCancel = true,
  active = true,
}: Props) {
  const [tab, setTab] = useState<Tab>("single");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    single: null,
    bo3: null,
    import: null,
  });
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const flipFromTop = useRef<number | null>(null);

  // "single"/"bo3" share one MatchForm instance and already animate their
  // shared actions row via the bo3-row grid collapse. Crossing into/out of
  // "import" remounts the whole content block, so capture the actions row's
  // position before the switch and FLIP it into its new spot after.
  function selectTab(next: Tab) {
    const crossesBoundary = (tab === "import") !== (next === "import");
    if (crossesBoundary) {
      const el = containerRef.current?.querySelector<HTMLElement>("[data-match-actions]");
      flipFromTop.current = el ? el.getBoundingClientRect().top : null;
    }
    setTab(next);
  }

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });

    if (flipFromTop.current !== null) {
      const fromTop = flipFromTop.current;
      flipFromTop.current = null;
      const actions = containerRef.current?.querySelector<HTMLElement>("[data-match-actions]");
      if (actions) {
        const delta = fromTop - actions.getBoundingClientRect().top;
        if (delta !== 0) {
          actions.style.transition = "none";
          actions.style.transform = `translateY(${delta}px)`;
          // Force a layout flush so the browser registers the offset
          // position before we animate back to rest — otherwise both
          // style writes land in the same frame and nothing transitions.
          actions.getBoundingClientRect();
          actions.style.transition = "transform 300ms ease";
          actions.style.transform = "";
          const onDone = () => {
            actions.style.transition = "";
            actions.removeEventListener("transitionend", onDone);
          };
          actions.addEventListener("transitionend", onDone);
        }
      }
    }
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
            onClick={() => selectTab(t.id)}
            className={`px-3 py-2 text-[15px] font-semibold transition-colors ${
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

      <div
        ref={containerRef}
        key={tab === "import" ? "import" : "form"}
        className="animate-tab-fade"
      >
        {tab === "import" ? (
          <BattleLogImportTab
            savedDeckId={savedDeckId}
            onSuccess={onImported}
            onCancel={onCancel}
            scrollToTopOnCancel={scrollToTopOnCancel}
          />
        ) : (
          <MatchForm
            onSubmit={onSubmitManual}
            onCancel={onCancel}
            bestOf3={tab === "bo3"}
            onBestOf3Change={(v) => setTab(v ? "bo3" : "single")}
            scrollToTopOnCancel={scrollToTopOnCancel}
            active={active}
          />
        )}
      </div>
    </div>
  );
}
