"use client";

import { useState } from "react";
import CardImage from "@/app/cards/CardImage";
import type { ResolvedDeckTile } from "@/lib/deckTiles";

const EXAMPLE_DECK = `Pokémon: 13
1 Meowth ex POR 62
3 N's Zoroark ex JTG 175
1 Munkidori TWM 95
1 Pecharunt ex SFA 39
1 N's Zorua PR-SV 189
1 Fezandipiti ex ASC 142
3 N's Zorua ASC 136
2 N's Reshiram ASC 154

Trainer: 15
4 N's PP Up ASC 195
3 Lillie's Determination ASC 192
1 Night Stretcher MEG 173
2 Janine's Secret Art SFA 59
2 Boss's Orders MEG 114
4 Ultra Ball MEG 131
2 N's Castle JTG 152

Energy: 1
8 Basic {D} Energy MEE 7

Total Cards: 60`;

const SECTION_LABEL: Record<ResolvedDeckTile["section"], string> = {
  pokemon: "Pokémon",
  trainer: "Trainer",
  energy: "Energy",
};

// Each fanned copy is offset by FAN_OVERLAP × the card's width.
const FAN_OVERLAP = 0.15;

export default function DeckMatClient() {
  const [deckList, setDeckList] = useState(EXAMPLE_DECK);
  const [tiles, setTiles] = useState<ResolvedDeckTile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardWidth, setCardWidth] = useState(96);

  async function handleRender() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deck-mat/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = await res.json();
      setTiles(body.tiles ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to render deck.");
    } finally {
      setLoading(false);
    }
  }

  const sections: Array<ResolvedDeckTile["section"]> = ["pokemon", "trainer", "energy"];
  const grouped = tiles
    ? sections
        .map((section) => ({
          section,
          items: tiles.filter((t) => t.section === section),
        }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        {/* Input column */}
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Deck list
          </label>
          <textarea
            value={deckList}
            onChange={(e) => setDeckList(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full h-[420px] rounded-2xl border border-black/10 bg-white p-3 font-mono text-xs leading-relaxed text-text-primary focus:outline-none focus-gradient-border transition-colors"
            placeholder="Paste a PTCGO/PTCGL deck list…"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRender}
              disabled={loading || !deckList.trim()}
              className="text-sm font-semibold px-4 py-2 rounded-full border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg disabled:opacity-40 disabled:shadow-none transition"
            >
              {loading ? "Rendering…" : "Render mat"}
            </button>
            {error && (
              <span className="text-xs text-accent">{error}</span>
            )}
          </div>

          <label className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Card size: {cardWidth}px
          </label>
          <input
            type="range"
            min={60}
            max={180}
            step={2}
            value={cardWidth}
            onChange={(e) => setCardWidth(Number(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Mat column */}
        <div className="rounded-2xl border border-black/8 bg-white p-4 min-h-[420px]">
          {!tiles ? (
            <div className="h-full min-h-[388px] flex items-center justify-center text-sm text-text-muted">
              Render a deck list to lay out the mat.
            </div>
          ) : tiles.length === 0 ? (
            <div className="h-full min-h-[388px] flex items-center justify-center text-sm text-text-muted">
              No cards parsed from this list.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {grouped.map((g) => (
                <section key={g.section}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                    {SECTION_LABEL[g.section]} —{" "}
                    {g.items.reduce((s, t) => s + t.copyCount, 0)}
                  </h3>
                  <div className="flex flex-wrap gap-x-6 gap-y-5">
                    {g.items.map((t) => (
                      <CardPile key={t.key} tile={t} cardWidth={cardWidth} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CardPile({
  tile,
  cardWidth,
}: {
  tile: ResolvedDeckTile;
  cardWidth: number;
}) {
  const cardHeight = Math.round((cardWidth * 342) / 245);
  const count = Math.max(tile.copyCount, 1);
  // Pile width = base card + (count - 1) × overlap-step
  const pileWidth = cardWidth + (count - 1) * cardWidth * FAN_OVERLAP;
  const alt = tile.setName
    ? `${tile.name} — ${tile.setName} ${tile.number}`
    : `${tile.name} ${tile.number}`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: pileWidth, height: cardHeight }}
      aria-label={`${tile.name} ×${count}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="absolute top-0 rounded overflow-hidden bg-surface shadow-sm"
          style={{
            left: i * cardWidth * FAN_OVERLAP,
            width: cardWidth,
            height: cardHeight,
            zIndex: i,
          }}
        >
          <CardImage
            src={tile.smallImageUrl}
            alt={alt}
            name={tile.name}
            setName={tile.setName}
            number={tile.number}
            className="w-full h-full object-contain"
          />
        </div>
      ))}
    </div>
  );
}
