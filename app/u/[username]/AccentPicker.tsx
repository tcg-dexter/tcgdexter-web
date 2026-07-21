"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { shade } from "@/lib/color";
import {
  BANNER_ACCENT_KEYS,
  BRAND_BANNER_GRADIENT,
  type BannerAccent,
} from "./UserProfileHeader";
import type { TeamCardRef } from "./TeamCards";
import TeamCardsModal from "./TeamCardsModal";

type SwatchValue = BannerAccent | null;

const SWATCH_LABEL: Record<string, string> = {
  Brand: "Signature",
  Fire: "Fire",
  Water: "Water",
  Grass: "Grass",
  Lightning: "Lightning",
  Psychic: "Psychic",
  Fighting: "Fighting",
  Darkness: "Darkness",
  Metal: "Metal",
  Dragon: "Dragon",
  Fairy: "Fairy",
  Colorless: "Colorless",
};

function swatchGradient(value: SwatchValue): string {
  if (!value) return BRAND_BANNER_GRADIENT;
  const hex = ENERGY_HEX[value];
  return `linear-gradient(180deg, ${hex} 0%, ${shade(hex, -22)} 100%)`;
}

interface Props {
  current: BannerAccent | null;
  teamCards: (TeamCardRef | null)[];
}

export default function AccentPicker({ current, teamCards }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SwatchValue>(current);
  const [cardsModalOpen, setCardsModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function pick(value: SwatchValue) {
    if (busy) return;
    setBusy(true);
    const previous = selected;
    setSelected(value);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banner_accent: value }),
      });
      if (!res.ok) {
        setSelected(previous);
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setSelected(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Edit banner color"
        aria-expanded={open}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-white/85 dark:bg-surface-2 text-text-primary shadow-md ring-1 ring-black/10 backdrop-blur hover:bg-white transition-colors"
      >
        {/* Pencil icon — "edit banner". */}
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zM19.5 7.125L16.875 4.5"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose banner color"
          className="absolute right-0 top-full mt-3 z-30 w-56 rounded-2xl border border-black/8 dark:border-white/10 bg-white/95 dark:bg-surface-elevated backdrop-blur-xl shadow-lg p-3"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 pb-2">
            Banner color
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Swatch
              label={SWATCH_LABEL.Brand}
              value={null}
              active={selected === null}
              busy={busy}
              onPick={pick}
            />
            {BANNER_ACCENT_KEYS.map((key) => (
              <Swatch
                key={key}
                label={SWATCH_LABEL[key]}
                value={key}
                active={selected === key}
                busy={busy}
                onPick={pick}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCardsModalOpen(true);
            }}
            className="mt-3 w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-black/10 dark:border-white/10 text-text-primary hover:bg-bg transition-colors"
          >
            Select Banner Cards
          </button>
        </div>
      )}

      {cardsModalOpen && (
        <TeamCardsModal initial={teamCards} onClose={() => setCardsModalOpen(false)} />
      )}
    </div>
  );
}

function Swatch({
  label,
  value,
  active,
  busy,
  onPick,
}: {
  label: string;
  value: SwatchValue;
  active: boolean;
  busy: boolean;
  onPick: (v: SwatchValue) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-10 h-10 rounded-full transition-transform hover:scale-105 disabled:opacity-60 ${
        active ? "ring-2 ring-offset-2 ring-text-primary ring-offset-white" : ""
      }`}
      style={{ background: swatchGradient(value) }}
    />
  );
}
