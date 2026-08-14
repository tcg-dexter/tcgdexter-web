import "server-only";

/**
 * Trainer Quiz — canonical question set.
 *
 * Server-only: never import this file from a Client Component. The
 * answer key must not reach the browser. `app/learn/quiz/page.tsx`
 * strips `answerIndex` from each question before passing them down to
 * `QuizClient`. Grading happens inside `/api/learn/quiz`.
 */

export type QuizQuestion = {
  id: number;
  prompt: string;
  options: string[];
  answerIndex: number;
  sourceLesson: string;
};

// The values live in lib/learn/quiz-constants.ts because QuizClient needs them
// too and cannot import this (server-only) module. Re-exported here so existing
// server-side importers keep a single import site.
import { PASSING_SCORE, QUIZ_LENGTH } from "@/lib/learn/quiz-constants";

export { PASSING_SCORE, QUIZ_LENGTH };

/**
 * One question per lesson, in lesson order. Keeping the mapping 1:1 means the
 * quiz can't drift away from what the curriculum actually teaches — the
 * previous set drew three of ten from `win-conditions` and never touched game
 * setup or Special Conditions.
 *
 * `curriculum.test.ts` asserts every `sourceLesson` resolves to a real lesson
 * and that each curriculum lesson is covered exactly once.
 */
export const QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    sourceLesson: "what-is-pokemon-tcg",
    prompt: "How many Prize cards do you need to take to win a game?",
    options: ["3", "4", "6", "8"],
    answerIndex: 2,
  },
  {
    id: 2,
    sourceLesson: "anatomy-pokemon-card",
    prompt:
      "Your opponent Knocks Out your Pokémon ex. How many Prize cards do they take?",
    options: ["1", "2", "3", "6"],
    answerIndex: 1,
  },
  {
    id: 3,
    sourceLesson: "anatomy-trainer-card",
    prompt:
      "You've already played a Supporter this turn. Which of these can you still do?",
    options: [
      "Play a second Supporter, if it has a different name",
      "Play as many Item cards as your hand allows",
      "Nothing else until your next turn",
      "Play one more Supporter, but only from the discard pile",
    ],
    answerIndex: 1,
  },
  {
    id: 4,
    sourceLesson: "anatomy-energy-card",
    prompt:
      "How many Energy cards may you attach from your hand during your turn?",
    options: [
      "One",
      "One per Pokémon in play",
      "As many as you like",
      "Two, but only to the Active Pokémon",
    ],
    answerIndex: 0,
  },
  {
    id: 5,
    sourceLesson: "deck-legality",
    prompt: "How many ACE SPEC cards may a 60-card deck contain?",
    options: [
      "One of each ACE SPEC card",
      "Four, like any other card",
      "One in the entire deck",
      "Unlimited",
    ],
    answerIndex: 2,
  },
  {
    id: 6,
    sourceLesson: "game-setup",
    prompt:
      "Your opening hand of 7 contains no Basic Pokémon. What happens?",
    options: [
      "You lose the game immediately",
      "You reveal your hand, shuffle and redraw — and your opponent draws an extra card",
      "You draw 3 more cards and keep going",
      "You start with your Active Spot empty",
    ],
    answerIndex: 1,
  },
  {
    id: 7,
    sourceLesson: "how-a-turn-works",
    prompt:
      "You just played a Basic Pokémon from your hand onto your Bench. Can you evolve it this same turn?",
    options: [
      "Yes — evolving is free",
      "Yes, but only into a Stage 1",
      "No — it must have been in play since the start of your turn",
      "Only if it is in the Active Spot",
    ],
    answerIndex: 2,
  },
  {
    id: 8,
    sourceLesson: "attacking-and-damage",
    prompt:
      "Your attack does 90 damage, and the defending Pokémon is Weak to your Pokémon's type. How much damage does it take?",
    options: ["90", "120", "180", "90, plus a Prize card"],
    answerIndex: 2,
  },
  {
    id: 9,
    sourceLesson: "special-conditions",
    prompt: "Which of these removes every Special Condition from a Pokémon?",
    options: [
      "Ending your turn",
      "Attacking with it",
      "Moving it out of the Active Spot",
      "Attaching an Energy to it",
    ],
    answerIndex: 2,
  },
  {
    id: 10,
    sourceLesson: "win-conditions",
    prompt: "Which of these is NOT a way to win the game?",
    options: [
      "Take all 6 of your Prize cards",
      "Your opponent has no Pokémon in play",
      "Your opponent can't draw a card at the start of their turn",
      "Knock Out the opponent's Active three turns in a row",
    ],
    answerIndex: 3,
  },
];

/** Public-safe shape — same as QuizQuestion but with the answer stripped. */
export type ClientQuizQuestion = Omit<QuizQuestion, "answerIndex">;

export function questionsForClient(): ClientQuizQuestion[] {
  return QUESTIONS.map(({ answerIndex: _omit, ...rest }) => rest);
}

/** Grades a submitted answer set. Returns the integer score (0–QUIZ_LENGTH). */
export function gradeAnswers(answers: number[]): number {
  if (!Array.isArray(answers) || answers.length !== QUIZ_LENGTH) return 0;
  let score = 0;
  for (let i = 0; i < QUIZ_LENGTH; i++) {
    if (Number.isInteger(answers[i]) && answers[i] === QUESTIONS[i].answerIndex) {
      score += 1;
    }
  }
  return score;
}
