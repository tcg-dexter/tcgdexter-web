import { ImageResponse } from "@vercel/og";
import { buildSubtypesByName, buildTypesByName } from "@/lib/cardTypes";
import {
  buildMatrixSlots,
  hexToRgba,
  MATRIX_ENERGY_PALETTE,
  pokemonPrimaryTypes,
  type MatrixSlot,
} from "@/lib/deckMatrix";

export const runtime = "edge";
export const alt = "Deck Profile — TCG Dexter";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface DeckCard {
  qty: number;
  name: string;
  section: string;
}

interface AnalysisResult {
  deckSize: number;
  sections: { pokemon: number; trainer: number; energy: number };
  deckPrice: number;
  rotation: { ready: boolean };
  metaMatch: { matched: boolean; archetypeName: string | null; matchPct: number | null };
  cards: DeckCard[];
}

interface DeckRecord {
  name: string;
  analysis: AnalysisResult;
  updatedAt: string;
  userId: string;
}

interface OwnerRecord {
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

async function fetchDeck(deckId: string): Promise<DeckRecord | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/saved_decks?id=eq.${encodeURIComponent(deckId)}&is_public=eq.true&select=name,analysis,updated_at,user_id`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ name: string; analysis: AnalysisResult; updated_at: string; user_id: string }>;
    if (!rows.length) return null;
    return { name: rows[0].name, analysis: rows[0].analysis, updatedAt: rows[0].updated_at, userId: rows[0].user_id };
  } catch { return null; }
}

async function fetchOwner(userId: string): Promise<OwnerRecord | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&is_public=eq.true&select=display_name,username,avatar_url`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ display_name: string; username: string; avatar_url: string | null }>;
    if (!rows.length) return null;
    return { displayName: rows[0].display_name, username: rows[0].username, avatarUrl: rows[0].avatar_url };
  } catch { return null; }
}

/* ─── Tile rendering ─────────────────────────────────────────── */

const TILE_SIZE = 46;
const TILE_GAP = 8;
const TILE_RADIUS = 6;

function renderTile(slot: MatrixSlot, i: number) {
  const base = { width: TILE_SIZE, height: TILE_SIZE, borderRadius: TILE_RADIUS, display: "flex" } as const;
  if (slot.kind === "empty") return <div key={i} style={{ ...base, border: "2px dashed rgba(0,0,0,0.18)", background: "transparent" }} />;
  if (slot.kind === "pokemon") {
    const baseColor = slot.energyType ? MATRIX_ENERGY_PALETTE[slot.energyType] : MATRIX_ENERGY_PALETTE.Colorless;
    return <div key={i} style={{ ...base, background: hexToRgba(baseColor, 0.5) }} />;
  }
  if (slot.kind === "trainer") return <div key={i} style={{ ...base, background: "#E6E6E6" }} />;
  if (slot.kind === "trainer-ace" || slot.kind === "energy-ace") return <div key={i} style={{ ...base, background: "#ED008C" }} />;
  if (slot.kind === "energy-basic") {
    const color = slot.energyType ? MATRIX_ENERGY_PALETTE[slot.energyType] : MATRIX_ENERGY_PALETTE.Colorless;
    return <div key={i} style={{ ...base, background: color }} />;
  }
  return <div key={i} style={{ ...base, backgroundImage: "linear-gradient(135deg,#C9C5BC 0%,#A8A8A8 100%)" }} />;
}

function renderMatrix(slots: MatrixSlot[]) {
  const rows: MatrixSlot[][] = [];
  for (let r = 0; r < 5; r++) rows.push(slots.slice(r * 12, r * 12 + 12));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: TILE_GAP }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", gap: TILE_GAP }}>
          {row.map((slot, c) => renderTile(slot, r * 12 + c))}
        </div>
      ))}
    </div>
  );
}

function LegendItem({ swatch, label, count }: { swatch: React.CSSProperties; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 16, height: 16, borderRadius: 4, ...swatch }} />
      <div style={{ display: "flex", fontSize: 16, color: "#2c1f0e", fontWeight: 600 }}>{count}</div>
      <div style={{ display: "flex", fontSize: 14, color: "#8b6040", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

/* ─── Image route ────────────────────────────────────────────── */

export default async function Image({ params }: { params: Promise<{ username: string; deckId: string }> }) {
  const { deckId } = await params;
  const deck = await fetchDeck(deckId);
  const owner = deck ? await fetchOwner(deck.userId) : null;

  if (!deck || !owner) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "#f5ede0", border: "4px solid #ecdcc8", borderRadius: 24 }}>
          <div style={{ display: "flex", fontSize: 28, color: "#8b6040" }}>TCG Dexter</div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: "#2c1f0e", marginTop: 16 }}>Deck Profile</div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 56, backgroundColor: "#2c1f0e", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0 0 20px 20px" }}>
            <div style={{ display: "flex", fontSize: 20, color: "#f5ede0" }}>tcgdexter.com</div>
          </div>
        </div>
      ),
      { ...size },
    );
  }

  const { analysis } = deck;
  const title = analysis.metaMatch.archetypeName ?? deck.name;

  const cards = analysis.cards ?? [];
  const pokemonTypes = pokemonPrimaryTypes(buildTypesByName(cards));
  const subtypesByName = buildSubtypesByName(cards);
  const slots = buildMatrixSlots(cards, pokemonTypes, subtypesByName);
  const aceCount = slots.filter((s) => s.kind === "trainer-ace" || s.kind === "energy-ace").length;

  const pokemonTypeCounts = new Map<string, number>();
  for (const s of slots) {
    if (s.kind === "pokemon" && s.energyType) pokemonTypeCounts.set(s.energyType, (pokemonTypeCounts.get(s.energyType) ?? 0) + 1);
  }
  const dominantType = Array.from(pokemonTypeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const pokemonSwatchColor = dominantType ? MATRIX_ENERGY_PALETTE[dominantType] : MATRIX_ENERGY_PALETTE.Colorless;

  const rotationReady = analysis.rotation.ready;
  const rotationLabel = rotationReady ? "✓ Standard Legal" : "⚠ Not Standard Legal";
  const rotationBg = rotationReady ? "#dcfce7" : "#fef3c7";
  const rotationBorder = rotationReady ? "#bbf7d0" : "#fde68a";
  const rotationColor = rotationReady ? "#166534" : "#92400e";

  const priceLabel = analysis.deckPrice > 0 ? `$${analysis.deckPrice.toFixed(2)}` : null;

  const metaMatched = analysis.metaMatch.matched;
  const metaLabel = metaMatched
    ? `${analysis.metaMatch.archetypeName} · ${((analysis.metaMatch.matchPct ?? 0) * 100).toFixed(1)}%`
    : "No Meta Match";
  const metaBg = metaMatched ? "#dcfce7" : "#f3f4f6";
  const metaBorder = metaMatched ? "#bbf7d0" : "#e5e7eb";
  const metaColor = metaMatched ? "#166534" : "#6b7280";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#f5ede0", border: "4px solid #ecdcc8", borderRadius: 24, position: "relative" }}>
        {/* Body row */}
        <div style={{ display: "flex", flex: 1, padding: "40px 48px 24px" }}>
          {/* Left — matrix */}
          <div style={{ display: "flex", flexDirection: "column", width: 720, justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 14, color: "#8b6040", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16 }}>
              Deck Composition{analysis.deckSize !== 60 ? ` · ${analysis.deckSize}/60` : ""}
            </div>
            {renderMatrix(slots)}
            <div style={{ display: "flex", gap: 24, marginTop: 24, flexWrap: "wrap" }}>
              <LegendItem swatch={{ background: hexToRgba(pokemonSwatchColor, 0.5) }} label="Pokémon" count={analysis.sections.pokemon} />
              <LegendItem swatch={{ background: "#E6E6E6" }} label="Trainer" count={analysis.sections.trainer} />
              <LegendItem swatch={{ background: MATRIX_ENERGY_PALETTE.Lightning }} label="Energy" count={analysis.sections.energy} />
              {aceCount > 0 && <LegendItem swatch={{ background: "#ED008C" }} label="Ace Spec" count={aceCount} />}
            </div>
          </div>

          {/* Right — attribution + title + pills */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingLeft: 40, justifyContent: "center" }}>
            {/* Trainer attribution */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              {owner.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={owner.avatarUrl}
                  width={40}
                  height={40}
                  style={{ borderRadius: 20, objectFit: "cover", border: "2px solid #ecdcc8" }}
                />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#ecdcc8", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ display: "flex", fontSize: 18, color: "#8b6040", fontWeight: 700 }}>
                    {owner.displayName.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 18, color: "#2c1f0e", fontWeight: 700 }}>{owner.displayName}</div>
                <div style={{ display: "flex", fontSize: 14, color: "#8b6040" }}>@{owner.username}</div>
              </div>
            </div>

            <div style={{ display: "flex", fontSize: 14, color: "#8b6040", marginBottom: 8 }}>TCG Dexter</div>
            <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#2c1f0e", lineHeight: 1.1, letterSpacing: -0.5 }}>
              {title}
            </div>

            {/* Pills */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24, alignItems: "flex-start" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 999, backgroundColor: rotationBg, border: `2px solid ${rotationBorder}`, fontSize: 16, fontWeight: 600, color: rotationColor }}>
                {rotationLabel}
              </div>
              {priceLabel && (
                <div style={{ display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 999, backgroundColor: "#f5ede0", border: "2px solid #ecdcc8", fontSize: 16, fontWeight: 600, color: "#2c1f0e" }}>
                  {priceLabel}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 999, backgroundColor: metaBg, border: `2px solid ${metaBorder}`, fontSize: 16, fontWeight: 600, color: metaColor, maxWidth: 360 }}>
                {metaLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 56, backgroundColor: "#2c1f0e", borderRadius: "0 0 20px 20px" }}>
          <div style={{ display: "flex", fontSize: 20, color: "#f5ede0" }}>tcgdexter.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
