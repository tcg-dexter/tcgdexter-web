"use client";

import { useEffect, useRef, useState } from "react";
import CopyDeckListButton from "@/app/components/CopyDeckListButton";

interface ParsedCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
}
interface ParsedSection {
  label: string;
  cards: ParsedCard[];
}

const CATEGORY_MAP: Record<string, string> = {
  "pokémon": "Pokémon",
  "pokemon": "Pokémon",
  "trainer": "Trainer",
  "energy": "Energy",
};

function parseDeckList(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const headerMatch = trimmed.match(/^([^:]+):\s*\d+/);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      if (key in CATEGORY_MAP) {
        current = { label: CATEGORY_MAP[key], cards: [] };
        sections.push(current);
        continue;
      }
    }
    if (current) {
      const tokens = trimmed.split(/\s+/);
      const qty = parseInt(tokens[0]);
      if (!isNaN(qty) && tokens.length >= 4) {
        current.cards.push({
          qty,
          name: tokens.slice(1, tokens.length - 2).join(" "),
          setCode: tokens[tokens.length - 2],
          number: tokens[tokens.length - 1],
        });
      }
    }
  }
  return sections;
}

function DeckListPanel({ deckList }: { deckList: string }) {
  const sections = parseDeckList(deckList);
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="mb-4 last:mb-0">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5">
            {section.label} — {section.cards.reduce((s, c) => s + c.qty, 0)}
          </h4>
          <div className="space-y-0.5">
            {section.cards.map((c, i) => (
              <div key={i} className="flex items-baseline gap-2 text-sm">
                <span className="text-text-muted w-5 text-right flex-shrink-0">×{c.qty}</span>
                <span className="text-text-primary">{c.name}</span>
                <span className="text-text-muted text-xs">{c.setCode} {c.number}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function MetaDeckListCarousel({
  deckLists,
  creators,
}: {
  deckLists: string[];
  creators?: string[];
}) {
  // Keep creators index-aligned with deckLists *before* the empty-string filter
  // so the indices we read inside the component still line up.
  const pairs = deckLists
    .map((d, i) => ({ list: d, creator: (creators?.[i] ?? "").trim() || "Trainer" }))
    .filter((p) => p.list.trim().length > 0);
  const lists = pairs.map((p) => p.list);
  const creatorNames = pairs.map((p) => p.creator);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = el.clientWidth;
        if (width <= 0) return;
        const idx = Math.round(el.scrollLeft / width);
        setActive((prev) => (prev === idx ? prev : Math.max(0, Math.min(lists.length - 1, idx))));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [lists.length]);

  const scrollTo = (idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  };

  if (lists.length === 0) return null;
  if (lists.length === 1) {
    // Single variant — render the same card chrome without carousel affordances.
    return (
      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Deck List</h2>
            <p className="text-xs text-text-secondary mt-0.5">{creatorNames[0]}</p>
          </div>
          <CopyDeckListButton deckList={lists[0]} iconOnly />
        </div>
        <DeckListPanel deckList={lists[0]} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-text-primary">Deck List</h2>
            <span className="text-xs text-text-muted">
              Variant {active + 1} of {lists.length}
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {creatorNames[active] ?? "Trainer"}
          </p>
        </div>
        <CopyDeckListButton deckList={lists[active] ?? lists[0]} iconOnly />
      </div>

      <div
        ref={scrollerRef}
        className="-mx-5 flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
        style={{ scrollbarWidth: "none" }}
      >
        {lists.map((list, i) => (
          <div
            key={i}
            className="snap-start shrink-0 basis-full px-5"
            aria-hidden={i !== active}
          >
            <DeckListPanel deckList={list} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5">
        {lists.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Show variant ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === active
                ? "w-1.5 bg-black dark:bg-white"
                : "w-6 bg-black/70 dark:bg-white/70 hover:bg-black/85 dark:hover:bg-white/85"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
