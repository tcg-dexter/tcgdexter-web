"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CertifiedTrainerBadge from "./CertifiedTrainerBadge";
import type { ClientQuizQuestion } from "./questions";

type Result = { score: number; passed: boolean };

const QUIZ_LENGTH = 10;
const NEXT_LESSON_HREF = "/learn/reading-a-deck-list";

export default function QuizClient({
  questions,
}: {
  questions: ClientQuizQuestion[];
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [answers, setAnswers] = useState<number[]>(() =>
    Array(QUIZ_LENGTH).fill(-1),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Track active slide via scrollLeft, same approach as MetaDeckListCarousel.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = el.clientWidth;
        if (width <= 0) return;
        const idx = Math.round(el.scrollLeft / width);
        setActive((prev) =>
          prev === idx ? prev : Math.max(0, Math.min(QUIZ_LENGTH - 1, idx)),
        );
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Auto-scroll the results card into view when a result lands.
  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const scrollTo = (idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  };

  const setAnswer = (qIdx: number, optionIdx: number) => {
    setAnswers((prev) => {
      const next = prev.slice();
      next[qIdx] = optionIdx;
      return next;
    });
  };

  const isLastQuestion = active === QUIZ_LENGTH - 1;
  const currentAnswered = answers[active] !== -1;
  const allAnswered = answers.every((a) => a !== -1);

  const handleNext = async () => {
    if (!isLastQuestion) {
      scrollTo(active + 1);
      return;
    }
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/learn/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Submission failed.");
      }
      const data = (await res.json()) as Result;
      setResult({ score: data.score, passed: data.passed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setError(null);
    setAnswers(Array(QUIZ_LENGTH).fill(-1));
    setActive(0);
    // Scroll the scroller back to slide 0; also bring the quiz card
    // back into view in case the result card is what's on screen.
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: 0, behavior: "smooth" });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Earned-state result is rendered server-side directly on the page;
  // here we only ever render Pass or Fail of a fresh attempt.
  return (
    <>
      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5 dark:bg-surface-elevated dark:border-white/10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Trainer Quiz
          </h2>
          <span className="text-xs text-text-muted tabular-nums">
            Question {active + 1} of {QUIZ_LENGTH}
          </span>
        </div>

        <div
          ref={scrollerRef}
          className="-mx-5 flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
          style={{ scrollbarWidth: "none" }}
        >
          {questions.map((q, qIdx) => (
            <div
              key={q.id}
              className="snap-start shrink-0 basis-full px-5"
              aria-hidden={qIdx !== active}
            >
              <p className="text-base font-medium text-text-primary leading-snug mb-4">
                {q.prompt}
              </p>
              <ul className="space-y-2">
                {q.options.map((opt, optIdx) => {
                  const checked = answers[qIdx] === optIdx;
                  return (
                    <li key={optIdx}>
                      <label
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                          checked
                            ? "border-accent bg-accent/5"
                            : "border-border bg-white hover:bg-black/[0.02] dark:bg-surface-2"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          value={optIdx}
                          checked={checked}
                          onChange={() => setAnswer(qIdx, optIdx)}
                          className="mt-1 accent-accent"
                        />
                        <span className="text-sm text-text-primary leading-snug">
                          {opt}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-xs text-rose-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => scrollTo(active - 1)}
            disabled={active === 0 || submitting}
            className="relative flex items-center justify-center rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-black/85 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-black dark:hover:bg-white/85"
          >
            <svg
              className="absolute left-5 w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!currentAnswered || submitting}
            className="relative flex items-center justify-center rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLastQuestion ? (submitting ? "Submitting…" : "Submit") : "Next"}
            {!isLastQuestion && (
              <svg
                className="absolute right-5 w-4 h-4"
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
            )}
          </button>
        </div>
      </div>

      {result && (
        <div
          ref={resultRef}
          className="mt-6 rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-6 text-center dark:bg-surface-elevated dark:border-white/10"
        >
          {result.passed ? (
            <>
              <div className="flex justify-center mb-4">
                <CertifiedTrainerBadge size="lg" />
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-1">
                You scored 10 / 10
              </h2>
              <p className="text-sm text-text-secondary mb-5">
                You're a Certified Trainer — the badge has been added to your
                profile.
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
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-text-primary mb-1">
                You scored {result.score} / 10
              </h2>
              <p className="text-sm text-text-secondary mb-5">
                You need 10 / 10 to earn the Certified Trainer badge. Review
                the basics and try again — you've got this.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
              >
                Retry quiz
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
