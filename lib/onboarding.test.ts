import { describe, it, expect } from "vitest";
import { computeOnboardingSteps } from "./onboarding";

describe("computeOnboardingSteps", () => {
  it("at the save→battle cliff, the hero is log_battle", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasBattle: false, hasPublicDeck: false, hasQuiz: false });
    expect(s.heroKey).toBe("log_battle");
    expect(s.completed).toBe(1);
    expect(s.allComplete).toBe(false);
  });

  it("after logging a battle, the hero advances to share_deck", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasBattle: true, hasPublicDeck: false, hasQuiz: false });
    expect(s.heroKey).toBe("share_deck");
    expect(s.completed).toBe(2);
  });

  it("after sharing a public deck, the hero advances to the quiz", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasBattle: true, hasPublicDeck: true, hasQuiz: false });
    expect(s.heroKey).toBe("quiz");
    expect(s.completed).toBe(3);
  });

  it("all steps done → no hero, allComplete", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasBattle: true, hasPublicDeck: true, hasQuiz: true });
    expect(s.heroKey).toBeNull();
    expect(s.allComplete).toBe(true);
    expect(s.completed).toBe(4);
  });

  it("with no deck yet, the hero is save_deck (empty-state territory)", () => {
    const s = computeOnboardingSteps({ hasDeck: false, hasBattle: false, hasPublicDeck: false, hasQuiz: false });
    expect(s.heroKey).toBe("save_deck");
    expect(s.completed).toBe(0);
  });

  it("steps are always in save → battle → share → quiz order", () => {
    const s = computeOnboardingSteps({ hasDeck: true, hasBattle: false, hasPublicDeck: false, hasQuiz: true });
    expect(s.steps.map((x) => x.key)).toEqual(["save_deck", "log_battle", "share_deck", "quiz"]);
    // quiz done but battle not → hero is still the earliest incomplete (battle)
    expect(s.heroKey).toBe("log_battle");
  });
});
