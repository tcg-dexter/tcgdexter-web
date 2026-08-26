import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import archetypesRaw from "@/data/meta-archetypes.json";
import metaDecksRaw from "@/data/meta-decks.json";
import { buildMetaAnalysis } from "@/lib/buildMetaAnalysis";
import { primaryPokemonCard } from "@/lib/primaryCardImage";

/**
 * GET    /api/saved-decks/meta/[archetypeId]/clone?variant=N — has the
 *                                                    caller already saved
 *                                                    this variant?
 * POST   /api/saved-decks/meta/[archetypeId]/clone?variant=N — materialise
 *                                                    variant N (0-based,
 *                                                    default 0 = top
 *                                                    variant) into the
 *                                                    caller's library
 *                                                    (idempotent).
 * DELETE /api/saved-decks/meta/[archetypeId]/clone?variant=N — remove the
 *                                                    saved row for that
 *                                                    variant.
 *
 * Mirrors the user-deck clone endpoint, except the source isn't a saved_decks
 * row — it's an entry in the static meta-decks.json bundle. We tag the new
 * row with meta_archetype_id + meta_variant_index so future "is this saved?"
 * lookups don't have to fuzzy-match on analysis JSON, and so distinct
 * variant cards on the same archetype page get independent save state
 * instead of one variant's save marking every variant "saved".
 *
 * Rows written before meta_variant_index existed are all implicitly variant
 * 0 (this endpoint only ever cloned the top variant back then), so variant 0
 * lookups match a NULL column alongside an explicit 0.
 */

function parseVariantIndex(url: string): number {
  const raw = new URL(url).searchParams.get("variant");
  const n = raw !== null ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface DeckCard {
  qty: number;
  name: string;
  setCode: string;
  number: string;
  category: "pokemon" | "trainer" | "energy";
}

interface MetaDeck {
  id: string;
  cards?: DeckCard[];
  variants?: { cards: DeckCard[]; creator?: string }[];
}

interface Archetype {
  id: string;
  name: string;
  total_entries: number;
  representation_pct: number;
  conversionRate?: number;
}

function serializeDeckList(cards: DeckCard[]): string {
  const order: DeckCard["category"][] = ["pokemon", "trainer", "energy"];
  const labels: Record<DeckCard["category"], string> = {
    pokemon: "Pokémon",
    trainer: "Trainer",
    energy: "Energy",
  };

  const lines: string[] = [];
  let total = 0;
  for (const section of order) {
    const inSection = cards.filter((c) => c.category === section);
    if (inSection.length === 0) continue;
    const count = inSection.reduce((s, c) => s + c.qty, 0);
    total += count;
    lines.push(`${labels[section]}: ${count}`);
    for (const c of inSection) {
      const tail = c.setCode && c.number ? ` ${c.setCode} ${c.number}` : "";
      lines.push(`${c.qty} ${c.name}${tail}`);
    }
    lines.push("");
  }
  lines.push(`Total Cards: ${total}`);
  return lines.join("\n");
}

function findArchetype(archetypeId: string, variantIndex: number) {
  const archetypes = archetypesRaw as Archetype[];
  const sorted = [...archetypes].sort(
    (a, b) => b.total_entries - a.total_entries,
  );
  const idx = sorted.findIndex((a) => a.id === archetypeId);
  if (idx === -1) return null;
  const arch = sorted[idx];
  const deckData = (metaDecksRaw as MetaDeck[]).find((d) => d.id === arch.id);
  const variant = deckData?.variants?.[variantIndex] ?? deckData?.variants?.[0];
  const cards = variant?.cards ?? deckData?.cards ?? [];
  return { arch, rank: idx + 1, cards };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ archetypeId: string }> },
) {
  const { archetypeId } = await params;
  const variantIndex = parseVariantIndex(req.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ saved: false, savedId: null });
  }

  let query = supabase
    .from("saved_decks")
    .select("id")
    .eq("meta_archetype_id", archetypeId)
    .eq("user_id", user.id);
  query =
    variantIndex === 0
      ? query.or("meta_variant_index.is.null,meta_variant_index.eq.0")
      : query.eq("meta_variant_index", variantIndex);
  const { data } = await query.limit(1).maybeSingle();

  return NextResponse.json({ saved: !!data, savedId: data?.id ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ archetypeId: string }> },
) {
  const { archetypeId } = await params;
  const variantIndex = parseVariantIndex(req.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 },
    );
  }

  // Idempotent — return existing save when there is one.
  let existingQuery = supabase
    .from("saved_decks")
    .select("id")
    .eq("meta_archetype_id", archetypeId)
    .eq("user_id", user.id);
  existingQuery =
    variantIndex === 0
      ? existingQuery.or("meta_variant_index.is.null,meta_variant_index.eq.0")
      : existingQuery.eq("meta_variant_index", variantIndex);
  const { data: existing } = await existingQuery.limit(1).maybeSingle();
  if (existing) {
    return NextResponse.json({ saved: true, savedId: existing.id });
  }

  const found = findArchetype(archetypeId, variantIndex);
  if (!found || found.cards.length === 0) {
    return NextResponse.json(
      { error: "Meta archetype not found." },
      { status: 404 },
    );
  }
  const { arch, rank, cards } = found;

  const deckList = serializeDeckList(cards);
  const analysis = buildMetaAnalysis(cards, {
    id: archetypeId,
    name: arch.name,
    rank,
    conversionRate: arch.conversionRate ?? 0,
    representationPct: arch.representation_pct,
  });
  const primaryPokemon = primaryPokemonCard(analysis.cards)?.card.name ?? null;

  const { data: cloned, error: insErr } = await supabase
    .from("saved_decks")
    .insert({
      user_id: user.id,
      name: arch.name,
      deck_list: deckList,
      analysis,
      meta_archetype_id: archetypeId,
      meta_variant_index: variantIndex,
      is_public: false,
      archetype_id: archetypeId,
      archetype_name: arch.name,
      archetype_source: "auto",
      primary_pokemon_name: primaryPokemon,
    })
    .select("id")
    .single();

  if (insErr || !cloned) {
    console.error("[saved-decks/meta/clone] insert failed:", insErr);
    return NextResponse.json(
      { error: "Failed to save deck." },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true, savedId: cloned.id });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ archetypeId: string }> },
) {
  const { archetypeId } = await params;
  const variantIndex = parseVariantIndex(req.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401 },
    );
  }

  let query = supabase
    .from("saved_decks")
    .delete()
    .eq("meta_archetype_id", archetypeId)
    .eq("user_id", user.id);
  query =
    variantIndex === 0
      ? query.or("meta_variant_index.is.null,meta_variant_index.eq.0")
      : query.eq("meta_variant_index", variantIndex);
  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ saved: false, savedId: null });
}
