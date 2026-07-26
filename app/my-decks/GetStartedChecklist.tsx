"use client";

import { useState } from "react";
import Link from "next/link";
import {
  computeOnboardingSteps,
  type OnboardingStep,
} from "@/lib/onboarding";

/**
 * "Get Started" onboarding module on /my-decks. Leads with a prominent
 * hero for the user's current step — at the save→match cliff that's "Log
 * your first match", the highest-leverage activation action — with the
 * full step list beneath. Auto-hides once every step is done; a Dismiss
 * control persists an early hide via profiles.onboarding_dismissed.
 *
 * The "Log a match" hero calls `onLogMatch`, which opens the pinned deck's
 * existing log drawer (the entry point already exists; this just surfaces
 * it). After a successful log the page refreshes and the step checks off.
 */
export default function GetStartedChecklist({
  hasDeck,
  hasMatch,
  hasQuiz,
  initialDismissed,
  onLogMatch,
}: {
  hasDeck: boolean;
  hasMatch: boolean;
  hasQuiz: boolean;
  initialDismissed: boolean;
  onLogMatch: () => void;
}) {
  const [hidden, setHidden] = useState(initialDismissed);

  const state = computeOnboardingSteps({ hasDeck, hasMatch, hasQuiz });

  // The empty-state on /my-decks already covers "save your first deck", so
  // only surface this once they have a deck (past step 1).
  if (hidden || state.allComplete || !hasDeck) return null;

  const hero = state.steps.find((s) => s.key === state.heroKey) ?? null;

  async function dismiss() {
    setHidden(true); // optimistic
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_dismissed: true }),
      });
    } catch {
      /* best-effort — it also auto-hides once complete */
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Get started</h2>
          <p className="text-xs text-text-muted tabular-nums mt-0.5">
            {state.completed} of {state.total} done
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss get started"
          className="shrink-0 -mr-1 -mt-1 p-1 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Hero — the current step, emphasized with an accent CTA. */}
      {hero && (
        <div className="mt-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-4">
          <p className="text-[15px] font-semibold text-text-primary">{hero.title}</p>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            {hero.description}
          </p>
          <div className="mt-3">
            <HeroCta stepKey={hero.key} label={hero.cta} onLogMatch={onLogMatch} />
          </div>
        </div>
      )}

      {/* Full step list. */}
      <ul className="mt-4 space-y-2">
        {state.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5">
            <StepIcon done={step.done} />
            <span
              className={`text-sm ${
                step.done
                  ? "text-text-muted line-through"
                  : step.key === state.heroKey
                    ? "text-text-primary font-medium"
                    : "text-text-secondary"
              }`}
            >
              {step.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeroCta({
  stepKey,
  label,
  onLogMatch,
}: {
  stepKey: OnboardingStep["key"];
  label: string;
  onLogMatch: () => void;
}) {
  const cls =
    "inline-flex items-center justify-center rounded-full bg-gradient-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90";
  if (stepKey === "log_match") {
    return (
      <button type="button" onClick={onLogMatch} className={cls}>
        {label}
      </button>
    );
  }
  const href = stepKey === "quiz" ? "/learn/quiz" : "/";
  return (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

function StepIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-block w-5 h-5 rounded-full border-2 border-black/15 dark:border-white/20" />
  );
}
