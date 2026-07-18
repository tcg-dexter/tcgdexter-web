import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/saved-decks/[id]/versions/[versionId]
 *   Full version row including deck_list + analysis — used by the diff
 *   view and read-only version browsing. RLS gates visibility (owner, or
 *   public deck + public owner).
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deck_versions")
    .select("id, deck_id, version_number, name, changelog, deck_list, analysis, created_at")
    .eq("deck_id", id)
    .eq("id", versionId)
    .maybeSingle();

  if (error) {
    console.error("[deck-versions] fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to load version." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Version not found." }, { status: 404 });
  }

  return NextResponse.json({ version: data });
}
