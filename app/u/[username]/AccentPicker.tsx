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
}

export default function AccentPicker({ current }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SwatchValue>(current);
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
        aria-label="Banner color"
        aria-expanded={open}
        className="text-text-muted hover:text-text-primary transition-colors"
      >
        {/* Paint-palette icon */}
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9 9 0 110-18 9 9 0 016.36 15.36c-.78.78-2.05.78-2.83 0a2 2 0 00-2.83 0c-.39.39-.59.9-.59 1.41 0 .51-.2 1.02-.59 1.41-.39.39-.9.59-1.41.59z"
          />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
          <circle cx="12" cy="7" r="1" fill="currentColor" />
          <circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose banner color"
          className="absolute right-0 top-full mt-2 z-20 w-56 rounded-2xl border border-black/8 bg-white/95 backdrop-blur-xl shadow-lg p-3"
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
        </div>
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
