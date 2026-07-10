import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { DeckParseError } from "@/lib/analyzeDeck";
import { commitDeckVersion } from "@/lib/deck-versions";

/**
 * POST /api/saved-decks/[id]/versions/[versionId]/restore
 *   Git-revert semantics: re-commits the old version's content as a NEW
 *   latest version — history is never rewritten. Owner only. Restoring the
 *   content the deck already has is caught by the no-op guard and returns
 *   created:false.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: deck } = await supabase
    .from("saved_decks")
    .select("id, user_id, archetype_id, archetype_name")
    .eq("id", id)
    .maybeSingle();

  if (!deck || deck.user_id !== user.id) {
    return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  }

  const { data: source } = await supabase
    .from("deck_versions")
    .select("id, version_number, name, deck_list")
    .eq("deck_id", id)
    .eq("id", versionId)
    .maybeSingle();

  if (!source) {
    return NextResponse.json({ error: "Version not found." }, { status: 404 });
  }

  try {
    const commit = await commitDeckVersion(supabase, {
      deckId: id,
      deckList: source.deck_list,
      changelog: `Restored from ${source.name ?? `v${source.version_number}`}`,
      currentArchetype: {
        id: deck.archetype_id ?? null,
        name: deck.archetype_name ?? null,
      },
    });

    if (commit.created) {
      void track(req, "deck.version_restored", {
        id,
        from_version: source.version_number,
        new_version: commit.version.version_number,
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
    });
  } catch (err) {
    if (err instanceof DeckParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[deck-versions] restore failed:", err);
    return NextResponse.json(
      { error: "Failed to restore version." },
      { status: 500 },
    );
  }
}
