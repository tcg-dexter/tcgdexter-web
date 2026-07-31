/**
 * Server-side Playmat renderer — composites a deck list into a PNG that
 * mirrors the on-site Playmat Studio mat (app/admin-tools/deck-mat), for
 * embedding in the weekly digest email (email clients can't run the live
 * React/canvas component).
 *
 * Layout is driven by the same exported pure helpers the live mat uses
 * (`computeRows`, `computeCardWidth`, `MAT_ASPECT`, `MAT_PADDING`,
 * `ROW_GAP_X`, `FAN_OVERLAP`) so piles land where they do on the site.
 * The default look matches PlaymatShowcase: the "fire-lightning" gradient
 * with the "lines" texture.
 */
import sharp from "sharp";
import { parseDeckListCards } from "@/lib/cardPrinting";
import { resolveDeckTiles, type ResolvedDeckTile } from "@/lib/deckTiles";
import {
  computeRows,
  computeCardWidth,
  MAT_ASPECT,
  MAT_PADDING,
  ROW_GAP_X,
  FAN_OVERLAP,
} from "@/lib/playmat-layout";

// fire-lightning = 135deg, shade(-22%) of Fire (#d93232) → Lightning (#f2b90c).
// Precomputed here to keep the renderer free of the client module's runtime.
const GRAD_FROM = "#a10000";
const GRAD_TO = "#ba8100";
const CARD_ASPECT = 342 / 245; // card height / width (matches the live mat)
const SLOT_BG = "#e8e8e8";

/** Absolute-ize a possibly site-relative image URL for server fetches. */
function absUrl(url: string, siteUrl: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/")) return `${siteUrl}${url}`;
  return url;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function svgEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** SVG "No image" placeholder mirroring app/cards/CardImage's failed state:
 *  a surface gradient with the card name + set · number. */
function placeholderSvg(w: number, h: number, radius: number, name: string, setName: string, number: string): Buffer {
  const nameSize = Math.max(9, Math.round(w * 0.11));
  const metaSize = Math.max(7, Math.round(w * 0.08));
  const short = name.length > 22 ? name.slice(0, 21) + "…" : name;
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e8e8e8"/><stop offset="100%" stop-color="#d8d8d8"/></linearGradient></defs>
    <rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="url(#s)"/>
    <text x="50%" y="${h * 0.36}" text-anchor="middle" font-family="sans-serif" font-size="${metaSize}" fill="#888888" letter-spacing="1">NO IMAGE</text>
    <text x="50%" y="${h * 0.52}" text-anchor="middle" font-family="sans-serif" font-size="${nameSize}" font-weight="700" fill="#1a1a1a">${svgEscape(short)}</text>
    <text x="50%" y="${h * 0.66}" text-anchor="middle" font-family="sans-serif" font-size="${metaSize}" fill="#4a4a4a">${svgEscape(setName)} · ${svgEscape(number)}</text>
  </svg>`);
}

/** A single card rendered to `w×h`: image contained on the slot bg, with
 *  rounded corners. Falls back to a "No image" placeholder when the image
 *  is missing (matching the on-site CardImage). */
async function renderCard(
  imgBuf: Buffer | null,
  w: number,
  h: number,
  radius: number,
  placeholder: { name: string; setName: string; number: string },
): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}"/></svg>`,
  );
  if (!imgBuf) {
    return sharp(placeholderSvg(w, h, radius, placeholder.name, placeholder.setName, placeholder.number))
      .png()
      .toBuffer();
  }
  const base = sharp({
    create: { width: w, height: h, channels: 4, background: SLOT_BG },
  });
  const fitted = await sharp(imgBuf)
    .resize(w, h, { fit: "contain", background: SLOT_BG })
    .toBuffer();
  return base
    .composite([{ input: fitted }, { input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export interface PlaymatRenderResult {
  png: Buffer;
  width: number;
  height: number;
  cardCount: number;
}

/**
 * Render `deckList` to a mat PNG. `width` is the mat pixel width (default
 * 960 for a ~480px retina display). Returns null if the deck resolves to
 * no cards.
 */
export async function renderPlaymatPng(
  deckList: string,
  opts: { width?: number; siteUrl?: string } = {},
): Promise<PlaymatRenderResult | null> {
  const matWidth = opts.width ?? 960;
  const siteUrl = (opts.siteUrl ?? "https://www.tcgdexter.com").replace(/\/$/, "");
  const matHeight = Math.round(matWidth * MAT_ASPECT);

  const tiles = resolveDeckTiles(parseDeckListCards(deckList));
  if (!tiles.length) return null;

  const rows = computeRows(tiles);
  const cardWidth = Math.round(computeCardWidth(rows, matWidth));
  const cardH = Math.round((cardWidth * 342) / 245);
  const radius = Math.max(2, Math.round(cardWidth * 0.05));
  void CARD_ASPECT;

  // Prefetch every distinct card image once.
  const urls = new Set<string>();
  for (const t of tiles) urls.add(t.smallImageUrl);
  const imgByUrl = new Map<string, Buffer | null>();
  await Promise.all(
    Array.from(urls).map(async (u) => imgByUrl.set(u, await fetchImage(absUrl(u, siteUrl)))),
  );

  // Cache rendered card slots by (url) — same card, same size everywhere.
  const cardByUrl = new Map<string, Buffer>();
  async function cardFor(t: ResolvedDeckTile): Promise<Buffer> {
    const cached = cardByUrl.get(t.smallImageUrl);
    if (cached) return cached;
    const buf = await renderCard(imgByUrl.get(t.smallImageUrl) ?? null, cardWidth, cardH, radius, {
      name: t.name,
      setName: t.setName,
      number: t.number,
    });
    cardByUrl.set(t.smallImageUrl, buf);
    return buf;
  }

  // Mat background: gradient + repeating "lines" texture, rounded corners.
  const matRadius = Math.round(matWidth * 0.018);
  const bgSvg = Buffer.from(`<svg width="${matWidth}" height="${matHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GRAD_FROM}"/><stop offset="100%" stop-color="${GRAD_TO}"/>
      </linearGradient>
      <pattern id="lines" width="12" height="12" patternUnits="userSpaceOnUse">
        <line x1="0" y1="12" x2="12" y2="0" stroke="white" stroke-width="1" stroke-opacity="0.35"/>
      </pattern>
      <clipPath id="round"><rect width="${matWidth}" height="${matHeight}" rx="${matRadius}" ry="${matRadius}"/></clipPath>
    </defs>
    <g clip-path="url(#round)">
      <rect width="${matWidth}" height="${matHeight}" fill="url(#g)"/>
      <rect width="${matWidth}" height="${matHeight}" fill="url(#lines)"/>
    </g>
  </svg>`);

  // Positioning — mirrors DeckMatClient's canvas export loop.
  const innerX = MAT_PADDING;
  const innerY = MAT_PADDING;
  const innerW = matWidth - MAT_PADDING * 2;
  const innerH = matHeight - MAT_PADDING * 2;
  const numRows = rows.length;

  const composites: sharp.OverlayOptions[] = [];
  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    const row = rows[rowIdx];
    const isLast = rowIdx === numRows - 1;
    const ry =
      numRows <= 1 ? innerY : innerY + (rowIdx * (innerH - cardH)) / (numRows - 1);

    const pileWidths = row.map(
      (t) => cardWidth + (Math.max(t.copyCount, 1) - 1) * cardWidth * FAN_OVERLAP,
    );
    const totalPileW = pileWidths.reduce((a, b) => a + b, 0);
    const spaceBetween =
      isLast || row.length <= 1
        ? ROW_GAP_X
        : Math.max(ROW_GAP_X, (innerW - totalPileW) / (row.length - 1));

    let pileX = innerX;
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const t = row[colIdx];
      const count = Math.max(t.copyCount, 1);
      const card = await cardFor(t);
      for (let i = 0; i < count; i++) {
        const cx = pileX + i * cardWidth * FAN_OVERLAP;
        composites.push({ input: card, left: Math.round(cx), top: Math.round(ry) });
      }
      pileX += pileWidths[colIdx] + spaceBetween;
    }
  }

  const png = await sharp(bgSvg).composite(composites).png().toBuffer();
  return { png, width: matWidth, height: matHeight, cardCount: tiles.length };
}
