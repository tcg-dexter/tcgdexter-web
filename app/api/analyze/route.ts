import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import {
  analyzeDeckList,
  DeckParseError,
  type AnalysisResult,
} from "@/lib/analyzeDeck";

/* The analysis computation lives in @/lib/analyzeDeck so other server
 * routes (e.g. saved-decks writes) can recompute snapshots without an HTTP
 * round-trip. This route adds the request-scoped side effects: submission
 * capture and the analytics event. */

export async function POST(req: NextRequest) {
  try {
    const { deckList } = (await req.json()) as { deckList?: string };

    if (!deckList || typeof deckList !== "string" || !deckList.trim()) {
      return NextResponse.json(
        { error: "Deck list is required." },
        { status: 400 }
      );
    }

    let result: AnalysisResult;
    try {
      result = analyzeDeckList(deckList);
    } catch (err) {
      if (err instanceof DeckParseError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    // ── Capture submission (fire-and-forget, never blocks response) ──
    // Phase 2: writes to Postgres instead of public Vercel Blob.
    // Uses the admin client (service role) because analysis_submissions
    // has no user-level RLS and anonymous users need to be able to submit.
    const locale = req.headers.get("accept-language")?.split(",")[0] ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // Attach user_id if signed in (non-blocking — if this fails, still capture anonymously)
    let userId: string | null = null;
    try {
      const userClient = await createClient();
      const {
        data: { user },
      } = await userClient.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      // Swallow — capture still happens anonymously.
    }

    try {
      const admin = createAdminClient();
      admin
        .from("analysis_submissions")
        .insert({
          user_id: userId,
          deck_list: deckList,
          analysis_summary: {
            deckSize: result.deckSize,
            sections: result.sections,
            rotation: result.rotation,
            metaMatch: result.metaMatch,
            deckScore: result.deckScore,
            warnings: result.warnings,
          },
          locale,
          user_agent: userAgent,
        })
        .then(({ error }) => {
          if (error) {
            console.error("[analyze] submission capture failed:", error);
          }
        });
    } catch (err) {
      // Swallow — never fail a user request over logging.
      console.error("[analyze] admin client init failed:", err);
    }

    // Behavioral event — joined into funnels/adoption views. The legacy
    // analysis_submissions insert above stays for its richer payload; this
    // mirrors the same fact in the unified events table.
    void track(req, "analyze.completed", {
      deck_size: result.deckSize,
      archetype: result.metaMatch?.archetypeName ?? null,
      anonymous: userId === null,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to analyze deck list." },
      { status: 500 }
    );
  }
}
