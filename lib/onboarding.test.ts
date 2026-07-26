import { describe, it, expect } from "vitest";
import { computeOnboardingSteps } from "./onboarding";

describe("computeOnboardingSteps", () => {
  it("at the save→match cliff, the hero is log_match", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasMatch: false, hasQuiz: false });
    expect(s.heroKey).toBe("log_match");
    expect(s.completed).toBe(1);
    expect(s.allComplete).toBe(false);
  });

  it("after logging a match, the hero advances to the quiz", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasMatch: true, hasQuiz: false });
    expect(s.heroKey).toBe("quiz");
    expect(s.completed).toBe(2);
  });

  it("all steps done → no hero, allComplete", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasMatch: true, hasQuiz: true });
    expect(s.heroKey).toBeNull();
    expect(s.allComplete).toBe(true);
    expect(s.completed).toBe(3);
  });

  it("with no deck yet, the hero is save_deck (empty-state territory)", () => {
    const s = computeOnboardingSteps({ hasDeck: false, hasMatch: false, hasQuiz: false });
    expect(s.heroKey).toBe("save_deck");
    expect(s.completed).toBe(0);
  });

  it("steps are always in save → match → quiz order", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasMatch: false, hasQuiz: true });
    expect(s.steps.map((x) => x.key)).toEqual(["save_deck", "log_match", "quiz"]);
    // quiz done but match not → hero is still the earliest incomplete (match)
    expect(s.heroKey).toBe("log_match");
  });
});
