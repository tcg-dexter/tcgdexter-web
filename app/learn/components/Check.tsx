"use client";

import { useState } from "react";

/**
 * An ungraded retrieval question, dropped inline at the point a lesson
 * finishes teaching something.
 *
 * The lessons used to be read-only prose all the way to a single summative
 * quiz; answering one question right after reading is what actually moves the
 * material into memory. Deliberately *not* connected to certification: no
 * API call, no persistence, nothing that touches `/api/learn/quiz` or the
 * `certified_trainer` badge. State is local to the component and resets on
 * navigation.
 *
 * The answer ships in the page source. That's fine here precisely because
 * this is formative and unscored — the graded quiz keeps its answer key
 * server-side in `app/learn/quiz/questions.ts` (`import "server-only"`).
 */
export default function Check({
  question,
  options,
  answer,
  explain,
}: {
  question: string;
  options: string[];
  /** Zero-based index into `options`. */
  answer: number;
  /** Shown once answered — explain *why*, don't just restate the answer. */
  explain: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === answer;

  return (
    <section className="my-6 rounded-xl border border-border bg-surface-elevated p-4 sm:p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
        Quick check
      </p>
      <p className="text-sm sm:text-base font-semibold text-text-primary leading-snug mb-3">
        {question}
      </p>

      <ul className="space-y-2">
        {options.map((opt, i) => {
          const isAnswer = i === answer;
          const isPicked = i === picked;

          let tone =
            "border-border bg-surface hover:border-text-muted dark:bg-surface-2";
          if (answered && isAnswer) {
            tone =
              "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-400";
          } else if (answered && isPicked) {
            tone =
              "border-accent bg-accent/10 dark:bg-accent/20";
          } else if (answered) {
            tone = "border-border bg-surface opacity-60 dark:bg-surface-2";
          }

          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => setPicked(i)}
                aria-pressed={isPicked}
                className={`w-full text-left text-sm rounded-lg border px-3 py-2 transition-colors text-text-primary ${tone}`}
              >
                <span className="font-mono text-xs text-text-muted mr-2">
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
                {answered && isAnswer && (
                  <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    correct
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {answered && (
        <div
          role="status"
          className="mt-3 rounded-lg bg-surface px-3 py-2.5 dark:bg-surface-2"
        >
          <p className="text-sm font-semibold text-text-primary mb-1">
            {correct ? "That's it." : "Not quite."}
          </p>
          <p className="text-sm leading-relaxed text-text-secondary">{explain}</p>
        </div>
      )}
    </section>
  );
}
