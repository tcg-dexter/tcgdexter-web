/**
 * "Get Started" onboarding — the activation checklist shown on /my-decks.
 *
 * Steps are derived purely from existing signals (has a saved deck, has
 * logged a battle, has a public deck, has the Certified Trainer quiz badge),
 * so there's no per-step state to store. The hero (the first incomplete
 * step) is what the UI emphasizes — at the save→battle cliff that's "Log
 * your first battle", the single action that feeds the whole retention loop.
 * "Share your first public deck" sits after it (sharing needs a deck to
 * share) so it never steals the hero from that cliff.
 */

export type OnboardingStepKey =
  | "save_deck"
  | "log_battle"
  | "share_deck"
  | "quiz";

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  /** Shown under the title when this step is the hero. */
  description: string;
  /** Hero call-to-action label. */
  cta: string;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  /** First incomplete step (what the UI leads with), or null when done. */
  heroKey: OnboardingStepKey | null;
  completed: number;
  total: number;
  allComplete: boolean;
}

export interface OnboardingSignals {
  hasDeck: boolean;
  hasBattle: boolean;
  hasPublicDeck: boolean;
  hasQuiz: boolean;
}

export function computeOnboardingSteps(s: OnboardingSignals): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      key: "save_deck",
      title: "Save your first deck",
      description: "Profile a deck list and save it to your collection.",
      cta: "Profile a deck",
      done: s.hasDeck,
    },
    {
      key: "log_battle",
      title: "Log your first battle",
      description:
        "Record a game to start tracking your win rate and build a daily streak.",
      cta: "Log a battle",
      done: s.hasBattle,
    },
    {
      key: "share_deck",
      title: "Share your first public deck",
      description:
        "Publish a deck to your trainer profile so others can discover and like it.",
      cta: "Share a deck",
      done: s.hasPublicDeck,
    },
    {
      key: "quiz",
      title: "Ace the Trainer Quiz",
      description: "Score 100% to earn the Certified Trainer badge.",
      cta: "Take the quiz",
      done: s.hasQuiz,
    },
  ];
  const hero = steps.find((step) => !step.done) ?? null;
  const completed = steps.filter((step) => step.done).length;
  return {
    steps,
    heroKey: hero ? hero.key : null,
    completed,
    total: steps.length,
    allComplete: completed === steps.length,
  };
}
