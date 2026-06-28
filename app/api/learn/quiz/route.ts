import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics/track";
import { CERTIFIED_TRAINER, hasAchievement } from "@/lib/learn/achievements";
import {
  PASSING_SCORE,
  QUIZ_LENGTH,
  gradeAnswers,
} from "@/app/learn/quiz/questions";

/**
 * POST /api/learn/quiz
 *
 * Grades the Trainer Quiz against the server-side answer key and, on a
 * perfect score, awards the Certified Trainer achievement.
 *
 * Body: { answers: number[] }  // length 10, integers 0–3
 * Response: { score, passed, alreadyEarned }
 *
 * The route intentionally does not echo per-question correctness — the
 * answer key never leaves the server.
 */
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: { answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answers = body.answers;
  if (
    !Array.isArray(answers) ||
    answers.length !== QUIZ_LENGTH ||
    !answers.every((a) => Number.isInteger(a) && a >= 0 && a <= 3)
  ) {
    return NextResponse.json(
      { error: `answers must be an array of ${QUIZ_LENGTH} integers (0-3).` },
      { status: 400 },
    );
  }

  // If the user already holds the badge, short-circuit. Mirrors the
  // earned-state branch in the page so a stray POST after the badge is
  // earned can't downgrade their status.
  const alreadyEarned = await hasAchievement(
    supabase,
    user.id,
    CERTIFIED_TRAINER,
  );
  if (alreadyEarned) {
    void track(req, "learn.quiz_completed", {
      score: QUIZ_LENGTH,
      passed: true,
      already_earned: true,
    });
    return NextResponse.json({
      score: QUIZ_LENGTH,
      passed: true,
      alreadyEarned: true,
    });
  }

  const score = gradeAnswers(answers as number[]);
  const passed = score >= PASSING_SCORE;
  void track(req, "learn.quiz_completed", { score, passed, already_earned: false });

  if (passed) {
    // Primary key (user_id, achievement_key) makes this idempotent —
    // a race between concurrent submissions can't double-insert.
    const { error } = await supabase
      .from("user_achievements")
      .insert({ user_id: user.id, achievement_key: CERTIFIED_TRAINER });

    // Unique-violation (Postgres 23505) is fine: another tab beat us.
    if (error && error.code !== "23505") {
      console.error("[learn/quiz] insert achievement failed:", error);
      return NextResponse.json(
        { error: "Failed to record badge." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ score, passed, alreadyEarned: false });
}
