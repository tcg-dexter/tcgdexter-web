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
} from "./admin-tools/deck-mat/DeckMatClient";

// fire-lightning: 4th-to-last gradient (shade("#d93232",-22) → shade("#f2b90c",-22))
const GRADIENT = "linear-gradient(135deg, #a10000 0%, #ba8100 100%)";
// lines: first texture pattern
const TEXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><line x1="0" y1="8" x2="8" y2="0" stroke="white" stroke-width="1" stroke-opacity="0.22"/></svg>`;

type AuthState = "loading" | "signedOut" | "noDecks" | "hasDecks";

export default function PlaymatShowcase({ tiles }: { tiles: ResolvedDeckTile[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(0);
  const [authState, setAuthState] = useState<AuthState>("loading");

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
  const texScale = matWidth > 0 ? matWidth / 600 : 1;

  const ctaBtnClass =
    "inline-flex items-center justify-center rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition";

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div ref={containerRef}>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            padding: MAT_PADDING,
            backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(TEXTURE_SVG)}"), ${GRADIENT}`,
            backgroundSize: `${8 * texScale}px ${8 * texScale}px, auto`,
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

      <div className="flex justify-center">
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
