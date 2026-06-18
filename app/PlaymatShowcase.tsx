"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import type { ResolvedDeckTile } from "@/lib/deckTiles";
import { createClient } from "@/lib/supabase/client";
import {
  computeRows,
  computeCardWidth,
  CardPile,
  MAT_PADDING,
  MAT_ASPECT,
  MAX_PILES_PER_ROW,
  ROW_GAP_X,
  MAT_STYLES,
  TEXTURES,
  type MatStyle,
} from "./admin-tools/deck-mat/DeckMatClient";

type AuthState = "loading" | "signedOut" | "noDecks" | "hasDecks";

export default function PlaymatShowcase({ tiles }: { tiles: ResolvedDeckTile[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(0);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [matStyle, setMatStyle] = useState<MatStyle>("fire-lightning");
  const [textureKey, setTextureKey] = useState<string | null>("lines");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setMatWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setAuthState("signedOut");
        return;
      }
      const { count } = await supabase
        .from("saved_decks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      setAuthState((count ?? 0) > 0 ? "hasDecks" : "noDecks");
    });
  }, []);

  const rows = computeRows(tiles);
  const cardWidth = computeCardWidth(rows, matWidth);
  const activeGradient = MAT_STYLES.find((s) => s.key === matStyle)?.gradient ?? null;
  const activeTex = TEXTURES.find((t) => t.key === textureKey) ?? null;
  const texScale = matWidth > 0 ? matWidth / 600 : 1;

  const ctaBtnClass =
    "inline-flex items-center justify-center rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition";

  const swatchBase = "w-7 h-7 md:w-[35px] md:h-[35px] rounded-full transition-all";
  const swatchSelected = "ring-2 ring-black ring-offset-1 ring-offset-[#f2f2f2] scale-110";
  const swatchHover = "hover:ring-1 hover:ring-black/25 hover:ring-offset-1 hover:ring-offset-[#f2f2f2]";

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      <div ref={containerRef}>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            padding: MAT_PADDING,
            backgroundImage: activeTex
              ? `url("data:image/svg+xml,${encodeURIComponent(activeTex.svg)}"), ${activeGradient}`
              : activeGradient ?? undefined,
            backgroundSize: activeTex
              ? `${activeTex.w * texScale}px ${activeTex.h * texScale}px, auto`
              : undefined,
            height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
            boxShadow: "0 4px 4px rgba(0,0,0,0.66)",
          }}
        >
          {tiles.length > 0 && matWidth > 0 && (
            <div className="flex flex-col h-full" style={{ justifyContent: "space-between" }}>
              {rows.map((row, rowIdx) => (
                <div
                  key={rowIdx}
                  className="flex"
                  style={{
                    gap: ROW_GAP_X,
                    justifyContent: rowIdx < rows.length - 1 ? "space-between" : "flex-start",
                  }}
                >
                  {row.map((t, colIdx) => (
                    <CardPile
                      key={t.key}
                      tile={t}
                      cardWidth={cardWidth}
                      index={rowIdx * MAX_PILES_PER_ROW + colIdx}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Color picker */}
      <div className="grid gap-1.5 pt-1 mx-auto [grid-template-columns:repeat(11,1.75rem)] md:[grid-template-columns:repeat(11,2.1875rem)]">
        {MAT_STYLES.map(({ key, gradient }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMatStyle(key)}
            aria-label={key}
            className={`${swatchBase} ${matStyle === key ? swatchSelected : swatchHover}`}
            style={{ background: gradient }}
          />
        ))}
      </div>

      {/* Texture picker */}
      <div className="grid gap-1.5 mx-auto [grid-template-columns:repeat(11,1.75rem)] md:[grid-template-columns:repeat(11,2.1875rem)]">
        {TEXTURES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTextureKey((prev) => (prev === t.key ? null : t.key))}
            aria-label={t.key}
            className={`${swatchBase} ${textureKey === t.key ? swatchSelected : swatchHover}`}
            style={{
              backgroundColor: "#3a3a3a",
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(t.svg)}")`,
              backgroundSize: `${t.w}px ${t.h}px`,
            }}
          />
        ))}
      </div>

      <div className="flex justify-center pt-2">
        {authState === "signedOut" && (
          <Link href="/sign-in?next=/admin-tools/deck-mat" className={ctaBtnClass}>
            Sign in to create
          </Link>
        )}
        {authState === "noDecks" && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className={ctaBtnClass}
          >
            Create a deck profile to unlock
          </button>
        )}
        {authState === "hasDecks" && (
          <Link href="/admin-tools/deck-mat" className={ctaBtnClass}>
            Create a playmat
          </Link>
        )}
      </div>
    </div>
  );
}
