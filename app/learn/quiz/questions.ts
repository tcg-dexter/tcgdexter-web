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

export const PASSING_SCORE = 10;
export const QUIZ_LENGTH = 10;

export const QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    sourceLesson: "what-is-pokemon-tcg",
    prompt: "How many prize cards do you need to take to win a game?",
    options: ["3", "4", "6", "8"],
    answerIndex: 2,
  },
  {
    id: 2,
    sourceLesson: "what-is-pokemon-tcg",
    prompt: "Which format does TCG Dexter check decks against by default?",
    options: ["Expanded", "Standard", "Unlimited", "Theme"],
    answerIndex: 1,
  },
  {
    id: 3,
    sourceLesson: "anatomy-pokemon-card",
    prompt:
      "What does the big number in the top-right corner of a Pokémon card represent?",
    options: [
      "Damage it deals",
      "Hit Points (HP)",
      "Retreat cost",
      "Prize cards given up",
    ],
    answerIndex: 1,
  },
  {
    id: 4,
    sourceLesson: "anatomy-pokemon-card",
    prompt: "Which kind of Pokémon can you play directly from your hand to the Bench?",
    options: ["Stage 1", "Stage 2", "Basic", "Any Evolution may be played"],
    answerIndex: 2,
  },
  {
    id: 5,
    sourceLesson: "anatomy-trainer-card",
    prompt:
      "How many copies of any single ACE SPEC card can you have in your deck?",
    options: ["2", "4", "1", "Unlimited"],
    answerIndex: 2,
  },
  {
    id: 6,
    sourceLesson: "anatomy-energy-card",
    prompt: "A Special Energy card differs from a basic Energy because it…",
    options: [
      "Has no effect",
      "Does something extra in addition to providing energy",
      "Counts as a Trainer card",
      "Cannot be attached to a Pokémon",
    ],
    answerIndex: 1,
  },
  {
    id: 7,
    sourceLesson: "how-a-turn-works",
    prompt: "When does drawing a card happen on your turn?",
    options: [
      "At the end of your turn",
      "Only when an effect says so",
      "At the start of your turn, before anything else",
      "Right before attacking",
    ],
    answerIndex: 2,
  },
  {
    id: 8,
    sourceLesson: "win-conditions",
    prompt: "Which of these is NOT a way to win the game?",
    options: [
      "Take all 6 of your prize cards",
      "Your opponent has no Pokémon in play",
      "Your opponent can't draw a card at the start of their turn",
      "Knock out the opponent's Active three turns in a row",
    ],
    answerIndex: 3,
  },
  {
    id: 9,
    sourceLesson: "win-conditions",
    prompt: "How many prize cards does a Mega Pokémon give up when it's knocked out?",
    options: ["1", "2", "3", "4"],
    answerIndex: 2,
  },
  {
    id: 10,
    sourceLesson: "win-conditions",
    prompt:
      "When your opponent's Active is knocked out, what happens if they have no Pokémon on the Bench to promote?",
    options: [
      "The game continues with their next draw",
      "You win the game immediately",
      "A coin flip decides the next Active",
      "You take a bonus prize card but the match continues",
    ],
    answerIndex: 1,
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
