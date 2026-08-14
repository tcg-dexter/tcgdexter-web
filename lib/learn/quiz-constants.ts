/**
 * Trainer Quiz constants that both the server and the client need.
 *
 * `app/learn/quiz/questions.ts` is `import "server-only"` — it holds the answer
 * key, so it must never be pulled into a Client Component. That used to force
 * `QuizClient` to redeclare `QUIZ_LENGTH` locally, and the post-quiz link to be
 * declared twice (once in the quiz page, once in the client). Splitting the
 * answer-free constants out lets both sides import the same values.
 *
 * Nothing with an answer in it belongs in this file.
 */

/** Number of questions asked, and the score required to pass. */
export const QUIZ_LENGTH = 10;
export const PASSING_SCORE = 10;

/**
 * Where a passing trainer goes next: the first lesson of the unlisted
 * product-tour track (see `first-deck` in lib/learn/curriculum.ts).
 */
export const POST_QUIZ_HREF = "/learn/reading-a-deck-list";
