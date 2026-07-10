import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { DeckParseError } from "@/lib/analyzeDeck";
import {
  VERSION_SUMMARY_COLUMNS,
  commitDeckVersion,
} from "@/lib/deck-versions";

/**
 * GET  /api/saved-decks/[id]/versions
 *   Version history, newest first. No deck_list in the payload — fetch a
 *   single version for its content. RLS decides visibility: owners see
 *   everything, visitors see history of public decks (public owner).
 *
 * POST /api/saved-decks/[id]/versions
 *   body: { deck_list, name?, changelog? }
 *   Commit a new version (owner only, enforced by RLS inside
 *   create_deck_version). Analysis is computed server-side. Saving an
 *   unchanged list returns the current latest with created:false.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deck_versions")
    .select(VERSION_SUMMARY_COLUMNS)
    .eq("deck_id", id)
    .order("version_number", { ascending: false });

  if (error) {
    console.error("[deck-versions] list failed:", error);
    return NextResponse.json(
      { error: "Failed to load versions." },
      { status: 500 },
    );
  }

  return NextResponse.json({ versions: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { deck_list?: string; name?: string; changelog?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deckList =
    typeof body.deck_list === "string" ? body.deck_list.trim() : "";
  if (!deckList) {
    return NextResponse.json(
      { error: "deck_list is required" },
      { status: 400 },
    );
  }

  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id, user_id, archetype_id, archetype_name")
    .eq("id", id)
    .maybeSingle();

  if (!deck || deck.user_id !== user.id) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }

  try {
    const commit = await commitDeckVersion(supabase, {
      deckId: id,
      deckList,
      name: typeof body.name === "string" ? body.name : null,
      changelog: typeof body.changelog === "string" ? body.changelog : "",
      currentArchetype: {
        id: deck.archetype_id ?? null,
        name: deck.archetype_name ?? null,
      },
    });

    if (commit.created) {
      void track(req, "deck.version_created", {
        id,
        version: commit.version.version_number,
      });
    }

    return NextResponse.json({
      created: commit.created,
      version: {
        id: commit.version.id,
        version_number: commit.version.version_number,
        name: commit.version.name,
        changelog: commit.version.changelog,
        created_at: commit.version.created_at,
      },
      analysis: commit.analysis,
      ...(commit.archetypeSuggestion
        ? { archetypeSuggestion: commit.archetypeSuggestion }
        : {}),
    });
  } catch (err) {
    if (err instanceof DeckParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[deck-versions] commit failed:", err);
    return NextResponse.json(
      { error: "Failed to save version." },
      { status: 500 },
    );
  }
}
