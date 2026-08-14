import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  CERTIFIED_TRAINER,
  hasAchievement,
} from "@/lib/learn/achievements";
import { questionsForClient } from "./questions";
import { POST_QUIZ_HREF as NEXT_LESSON_HREF } from "@/lib/learn/quiz-constants";
import QuizClient from "./QuizClient";
import CertifiedTrainerBadge from "./CertifiedTrainerBadge";
import TrackView from "@/app/components/TrackView";

export const metadata: Metadata = {
  title: "Trainer Quiz | Learn to Play",
  description:
    "Pass the 10-question Trainer Quiz to earn your Certified Trainer badge.",
};

// Quiz state is per-user; never cache.
export const dynamic = "force-dynamic";

export default async function QuizPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Signed-out: sign-in CTA ───────────────────────────────────────
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
        <nav className="text-xs text-text-muted mb-6 flex items-center gap-2 flex-wrap">
          <Link href="/learn" className="hover:text-text-secondary">
            Learn to Play
          </Link>
          <span aria-hidden>›</span>
          <span>Trainer Quiz</span>
        </nav>

        <header className="mb-6">
          <p className="text-xs font-semibold text-accent uppercase tracking-[0.15em] mb-2">
            Trainer Quiz
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3 leading-tight">
            Earn your Certified Trainer badge
          </h1>
          <p className="text-base text-text-secondary leading-relaxed">
            One question from each of the ten lessons. Score 10 / 10 and the
            Certified Trainer badge lands on your profile.
          </p>
        </header>

        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-6 text-center dark:bg-surface-elevated dark:border-white/10">
          <div className="flex justify-center mb-4">
            <CertifiedTrainerBadge size="md" />
          </div>
          <p className="text-sm text-text-secondary mb-5">
            Sign in to take the quiz so we can save your badge.
          </p>
          <Link
            href="/sign-in?next=/learn/quiz"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
          >
            Sign in to start
          </Link>
        </div>
      </main>
    );
  }

  // ── Signed-in: check earned state ─────────────────────────────────
  const alreadyEarned = await hasAchievement(
    supabase,
    user.id,
    CERTIFIED_TRAINER,
  );

  if (alreadyEarned) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
        <nav className="text-xs text-text-muted mb-6 flex items-center gap-2 flex-wrap">
          <Link href="/learn" className="hover:text-text-secondary">
            Learn to Play
          </Link>
          <span aria-hidden>›</span>
          <span>Trainer Quiz</span>
        </nav>

        <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-6 text-center dark:bg-surface-elevated dark:border-white/10">
          <div className="flex justify-center mb-4">
            <CertifiedTrainerBadge size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">
            You're a Certified Trainer
          </h1>
          <p className="text-sm text-text-secondary mb-5">
            You've already passed the Trainer Quiz. The badge is on your
            profile — ready to keep going?
          </p>
          <Link
            href={NEXT_LESSON_HREF}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
          >
            Start: Your First Deck
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </main>
    );
  }

  // ── Signed-in, not earned: render the quiz carousel ───────────────
  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
      <TrackView event="learn.quiz_started" />
      <nav className="text-xs text-text-muted mb-6 flex items-center gap-2 flex-wrap">
        <Link href="/learn" className="hover:text-text-secondary">
          Learn to Play
        </Link>
        <span aria-hidden>›</span>
        <span>Trainer Quiz</span>
      </nav>

      <header className="mb-6">
        <p className="text-xs font-semibold text-accent uppercase tracking-[0.15em] mb-2">
          Trainer Quiz
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3 leading-tight">
          Earn your Certified Trainer badge
        </h1>
        <p className="text-base text-text-secondary leading-relaxed">
          One question from each of the ten lessons. Score 10 / 10 to earn the
          badge.
        </p>
      </header>

      <QuizClient questions={questionsForClient()} />
    </main>
  );
}
