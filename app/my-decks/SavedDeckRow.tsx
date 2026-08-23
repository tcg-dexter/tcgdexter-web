"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type BattleFormData } from "@/app/components/BattleForm";
import BattleEntry from "@/app/components/BattleEntry";
import type { UserDeckCardProps } from "@/app/components/DeckPostCard";
import { clientTz, celebrateStreak } from "@/lib/streak-client";

/** Compact three-segment composition bar — the List-view counterpart to
 *  CompositionRing, sharing the same color scheme (black Pokémon, brand
 *  gradient Trainer, white+black-border Energy). */
export function CompositionBar({ counts }: { counts: NonNullable<UserDeckCardProps["counts"]> }) {
  const total = counts.pokemon + counts.trainer + counts.energy;
  if (total <= 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <div className="flex flex-col gap-1 w-full max-w-[140px]">
      <div className="flex h-[7px] gap-[2px] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: pct(counts.pokemon), background: "var(--text-primary)" }} />
        <div className="h-full rounded-full" style={{ width: pct(counts.trainer), background: "var(--gradient-brand)" }} />
        <div
          className="h-full rounded-full"
          style={{ width: pct(counts.energy), background: "#ffffff", border: "1px solid var(--text-primary)", boxSizing: "border-box" }}
        />
      </div>
      <span className="text-[10.5px] font-semibold text-text-muted tabular-nums">
        {counts.pokemon} P · {counts.trainer} T · {counts.energy} E
      </span>
    </div>
  );
}

export function RecordPill({ wl }: { wl?: UserDeckCardProps["wl"] }) {
  const hasRecord = !!wl && wl.w + wl.l + wl.d > 0;
  return hasRecord ? (
    <span className="rounded-full bg-black dark:bg-white px-[11px] py-1 text-[12.5px] font-extrabold text-white dark:text-black tabular-nums">
      {wl!.w}–{wl!.l}
    </span>
  ) : (
    <span className="rounded-full bg-black/5 px-[11px] py-1 text-[12.5px] font-extrabold text-text-muted tabular-nums">0–0</span>
  );
}

export function FormPips({ recentForm }: { recentForm?: ("W" | "L" | "D")[] }) {
  if (!recentForm || recentForm.length === 0) {
    return <span className="text-[11px] font-semibold text-text-muted">No battles</span>;
  }
  return (
    <div className="flex gap-[3px]">
      {recentForm.map((r, i) => (
        <span
          key={i}
          className={`w-[17px] h-[17px] rounded-full text-[9px] font-extrabold flex items-center justify-center ${
            r === "W"
              ? "bg-[linear-gradient(135deg,#F2A20C_0%,#D91E0D_50%,#A60D0D_100%)] text-white"
              : r === "L"
              ? "bg-black dark:bg-white text-white dark:text-black"
              : "bg-black/5 text-text-muted"
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

/**
 * Single row in the My Decks List view. Mirrors the fields shown on the
 * Grid card (UserDeckCard) in a denser, table-like layout: recent form,
 * composition, price, and quick actions (record is shown inline under the
 * deck name on mobile, where the recent-form/composition columns are hidden).
 * Tapping the row navigates to the deck profile; Log battle expands the
 * same inline BattleEntry flow (Single/Best of 3/TCG Live import) used by
 * the grid cards and the pinned-deck hero, without leaving the page.
 */
export default function SavedDeckRow({
  id,
  name,
  href,
  imageUrl,
  price,
  counts,
  wl,
  updatedAt,
  isLast,
}: UserDeckCardProps & { isLast?: boolean }) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);

  async function handleQuickLog(data: BattleFormData) {
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved_deck_id: id, ...data, tz: clientTz() }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error ?? "Failed to log battle.");
    }
    celebrateStreak(json.streak);
    setLogOpen(false);
    router.refresh();
  }

  const updatedLabel = updatedAt
    ? `Updated ${new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : null;

  return (
    <div className={`bg-white dark:bg-surface-elevated${isLast ? "" : " border-b border-bg"}`}>
      <div className="flex items-center gap-3.5 px-4 py-3">
        <Link href={href} className="shrink-0">
          <div
            className="w-11 h-14 rounded-[5px] bg-surface overflow-hidden flex items-center justify-center"
          >
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
            ) : null}
          </div>
        </Link>

        <div className="min-w-[140px] flex-1">
          <Link href={href} className="font-semibold text-text-primary text-[14.5px] truncate hover:underline underline-offset-2 block">
            {name}
          </Link>
          {/* Mobile only — the dedicated record column is hidden below sm,
              so the W-L pill moves here, leading the updated-date text. */}
          <div className="flex items-center gap-2 mt-0.5 sm:hidden">
            <RecordPill wl={wl} />
            {updatedLabel && <span className="text-[11.5px] text-text-muted">{updatedLabel}</span>}
          </div>
          {updatedLabel && <span className="hidden sm:block text-[11.5px] text-text-muted">{updatedLabel}</span>}
        </div>

        <div className="w-[110px] shrink-0 hidden sm:block">
          <FormPips recentForm={wl?.recentForm} />
        </div>

        <div className="w-[150px] shrink-0 hidden md:block">
          {counts ? <CompositionBar counts={counts} /> : null}
        </div>

        <div className="w-[70px] shrink-0 hidden lg:block text-[13px] font-bold text-text-secondary tabular-nums">
          {price != null ? `$${price.toFixed(2)}` : "—"}
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={() => setLogOpen((o) => !o)}
            className={`rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold transition-all ${
              logOpen ? "text-white" : "text-text-secondary"
            }`}
            style={{
              backgroundImage: logOpen
                ? "linear-gradient(var(--accent), var(--accent)), var(--gradient-brand)"
                : "linear-gradient(var(--bg), var(--bg)), var(--gradient-brand)",
              backgroundOrigin: "border-box",
              backgroundClip: "padding-box, border-box",
            }}
          >
            Log battle
          </button>
        </div>
      </div>

      {logOpen && (
        <div className="px-4 pb-4">
          <BattleEntry
            savedDeckId={id}
            onSubmitManual={handleQuickLog}
            onImported={() => {
              setLogOpen(false);
              router.refresh();
            }}
            onCancel={() => setLogOpen(false)}
            scrollToTopOnCancel={false}
          />
        </div>
      )}
    </div>
  );
}
