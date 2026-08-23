"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type TabId = "decks" | "battles";

interface Props {
  /** Resolved solid hex for the user's chosen banner accent — drives the
   *  sliding tab indicator so it matches the rest of the header. */
  accentColor: string;
  decksCount: number;
  decksContent: ReactNode;
  decksViewAllHref: string;
  showDecksViewAll: boolean;
  battlesCount: number;
  battlesContent: ReactNode;
  battlesViewAllHref: string;
  showBattlesViewAll: boolean;
}

/**
 * "My Decks" / "Recent Battles" segmented tabs on the owner's profile.
 * Mirrors BattleEntry's Single/Best of 3/TCG Live tab strip — a sliding
 * underline indicator (position measured off the active button's
 * offsetLeft/offsetWidth, animated via CSS transition) plus a fade on
 * the content swap — except the indicator takes the user's accent color
 * instead of the static brand accent.
 */
export default function ProfileTabs({
  accentColor,
  decksCount,
  decksContent,
  decksViewAllHref,
  showDecksViewAll,
  battlesCount,
  battlesContent,
  battlesViewAllHref,
  showBattlesViewAll,
}: Props) {
  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: "decks", label: "My Decks", count: decksCount },
    { id: "battles", label: "Recent Battles", count: battlesCount },
  ];

  const [tab, setTab] = useState<TabId>("decks");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    decks: null,
    battles: null,
  });
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  const viewAllHref = tab === "decks" ? decksViewAllHref : battlesViewAllHref;
  const showViewAll = tab === "decks" ? showDecksViewAll : showBattlesViewAll;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border mb-4">
        <div className="relative flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-[15px] font-semibold transition-colors ${
                tab === t.id
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-1.5 text-xs font-normal text-text-muted">
                  {t.count}
                </span>
              )}
            </button>
          ))}
          <div
            className="absolute bottom-0 h-0.5 transition-all duration-300"
            style={{ left: indicator.left, width: indicator.width, background: accentColor }}
          />
        </div>
        {showViewAll && (
          <Link
            href={viewAllHref}
            className="shrink-0 rounded-full bg-black dark:bg-white border border-transparent px-3 py-1.5 text-xs font-semibold text-white dark:text-black hover:opacity-80 transition-opacity"
          >
            View All
          </Link>
        )}
      </div>

      <div key={tab} className="animate-tab-fade">
        {tab === "decks" ? decksContent : battlesContent}
      </div>
    </div>
  );
}
