import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cleanCardRefs,
  cleanIdList,
  cleanQA,
} from "@/lib/spotlight/validate";
import {
  EDITABLE_STATUSES,
  requireInvitedSpotlight,
} from "@/lib/spotlight/onboarding";
import {
  MAX_ANSWERS,
  MAX_FAVORITE_CARDS,
  MAX_FEATURED_DECKS,
  MIN_ANSWERS,
} from "@/app/spotlight/questions";
import {
  normalizeSubmission,
  type SpotlightSubmission,
} from "@/app/spotlight/types";

const MAX_TEXT = 8000;
const MAX_HEADLINE = 200;
const MAX_LISTS = 5;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * PUT /api/spotlight/onboarding
 * Body: { submission: SpotlightSubmission, submit?: boolean }
 *
 * Saves the featured trainer's own onboarding content. There is no id in the
 * request — the row is resolved from the session — so a trainer can only ever
 * write their own spotlight.
 *
 * The write itself goes through the service-role client: RLS grants the
 * subject SELECT only, deliberately, because a row-level UPDATE policy could
 * not stop them from also setting slug / qa / is_published. This route is the
 * column whitelist. It writes `submission` (and the two lifecycle columns)
 * and nothing else.
 *
 * With `submit: true` the submission is validated as complete and the status
 * advances to "submitted".
 */
export async function PUT(req: Request) {
  const ctx = await requireInvitedSpotlight();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const { spotlight } = ctx;

  if (!EDITABLE_STATUSES.includes(spotlight.submission_status)) {
    return NextResponse.json(
      {
        error:
          spotlight.submission_status === "approved"
            ? "This spotlight has already been approved."
            : "This spotlight is being reviewed and can't be edited right now.",
      },
      { status: 409 },
    );
  }

  let body: { submission?: unknown; submit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.submission || typeof body.submission !== "object") {
    return NextResponse.json(
      { error: "submission must be an object" },
      { status: 400 },
    );
  }
  const raw = body.submission as Record<string, unknown>;
  const submit = body.submit === true;

  const pokemon = raw.favorite_pokemon as { name?: unknown } | null | undefined;
  const cleaned: SpotlightSubmission = {
    headline: text(raw.headline, MAX_HEADLINE),
    intro: text(raw.intro, MAX_TEXT),
    favorite_pokemon:
      pokemon && typeof pokemon.name === "string" && pokemon.name.trim()
        ? { name: pokemon.name.trim() }
        : null,
    collection_cards: Array.isArray(raw.collection_cards)
      ? cleanCardRefs(raw.collection_cards).slice(0, MAX_FAVORITE_CARDS)
      : [],
    play_cards: Array.isArray(raw.play_cards)
      ? cleanCardRefs(raw.play_cards).slice(0, MAX_FAVORITE_CARDS)
      : [],
    answers: Array.isArray(raw.answers)
      ? cleanQA(raw.answers)
          .filter((item) => item.q.trim() && item.a.trim())
          .slice(0, MAX_ANSWERS)
      : [],
    deck_ids: Array.isArray(raw.deck_ids)
      ? cleanIdList(raw.deck_ids, MAX_FEATURED_DECKS)
      : [],
    list_short_ids: Array.isArray(raw.list_short_ids)
      ? cleanIdList(raw.list_short_ids, MAX_LISTS)
      : [],
    // Set only by the avatar route — carried forward from the stored row so a
    // form save can never clear or forge it.
    avatar_upload_url:
      normalizeSubmission(spotlight.submission).avatar_upload_url,
    notes: text(raw.notes, MAX_TEXT),
  };

  // Decks and lists must belong to the trainer. Checked with the session
  // client so RLS does the ownership work, before the service-role write.
  const supabase = await createClient();
  if (cleaned.deck_ids.length > 0) {
    const { data: owned } = await supabase
      .from("saved_decks")
      .select("id")
      .in("id", cleaned.deck_ids);
    const ownedIds = new Set((owned ?? []).map((d) => d.id));
    cleaned.deck_ids = cleaned.deck_ids.filter((id) => ownedIds.has(id));
  }
  if (cleaned.list_short_ids.length > 0) {
    const { data: owned } = await supabase
      .from("lists")
      .select("short_id")
      .in("short_id", cleaned.list_short_ids);
    const ownedIds = new Set((owned ?? []).map((l) => l.short_id));
    cleaned.list_short_ids = cleaned.list_short_ids.filter((id) =>
      ownedIds.has(id),
    );
  }

  if (submit) {
    const problems: string[] = [];
    if (!cleaned.intro) problems.push("an introduction");
    if (cleaned.answers.length < MIN_ANSWERS) {
      problems.push(`at least ${MIN_ANSWERS} answered questions`);
    }
    if (problems.length > 0) {
      return NextResponse.json(
        { error: `Please add ${problems.join(" and ")} before submitting.` },
        { status: 400 },
      );
    }
  }

  const update: Record<string, unknown> = { submission: cleaned };
  if (submit) {
    update.submission_status = "submitted";
    update.submitted_at = new Date().toISOString();
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("trainer_spotlights")
    .update(update)
    .eq("id", spotlight.id);
  if (error) {
    console.error("[spotlight onboarding] save failed:", error);
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submission: cleaned, submitted: submit });
}
