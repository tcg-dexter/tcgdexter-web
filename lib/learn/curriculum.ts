// Curriculum metadata for Trainer School.
//
// Lesson bodies live in app/learn/(content)/<slug>.mdx. This file is the single
// source of truth for order, module grouping and per-lesson metadata — the MDX
// frontmatter is parsed and discarded by the lesson route, so anything that
// matters to routing or presentation belongs here.
//
// `lib/learn/curriculum.test.ts` guards the invariants: every lesson has a
// matching .mdx (and vice versa), orders are unique and contiguous, and every
// quiz question points at a real lesson.

export type ModuleId = "know-your-cards" | "play-a-game" | "first-deck";

export type Lesson = {
  slug: string;
  title: string;
  module: ModuleId;
  order: number;
  estimatedMinutes: number;
};

export type Module = {
  id: ModuleId;
  title: string;
  description: string;
  order: number;
};

/**
 * Modules presented on the /learn index, in order. This is the graded
 * curriculum — finishing the last lesson of the last module leads to the
 * Trainer Quiz.
 *
 * `first-deck` is deliberately absent. Those three lessons are a product tour
 * rather than rules teaching, so they stay unlisted and routable, reached from
 * the post-quiz CTA. See CURRICULUM_MODULE_IDS below.
 */
export const modules: Module[] = [
  {
    id: "know-your-cards",
    title: "Know Your Cards",
    description:
      "The board, the three kinds of card, and what makes a deck legal.",
    order: 1,
  },
  {
    id: "play-a-game",
    title: "Play a Game",
    description:
      "Set up, take a turn, deal damage, handle Special Conditions, and win.",
    order: 2,
  },
];

export const lessons: Lesson[] = [
  // ── Module 1 — Know Your Cards ──
  { slug: "what-is-pokemon-tcg",     title: "What you're playing",              module: "know-your-cards", order:  1, estimatedMinutes: 4 },
  { slug: "anatomy-pokemon-card",    title: "Anatomy of a Pokémon card",        module: "know-your-cards", order:  2, estimatedMinutes: 5 },
  { slug: "anatomy-trainer-card",    title: "Anatomy of a Trainer card",        module: "know-your-cards", order:  3, estimatedMinutes: 5 },
  { slug: "anatomy-energy-card",     title: "Anatomy of an Energy card",        module: "know-your-cards", order:  4, estimatedMinutes: 4 },
  { slug: "deck-legality",           title: "What makes a legal deck",          module: "know-your-cards", order:  5, estimatedMinutes: 4 },

  // ── Module 2 — Play a Game ──
  { slug: "game-setup",              title: "Setting up",                       module: "play-a-game",     order:  6, estimatedMinutes: 5 },
  { slug: "how-a-turn-works",        title: "How a turn works",                 module: "play-a-game",     order:  7, estimatedMinutes: 5 },
  { slug: "attacking-and-damage",    title: "Attacking and damage",             module: "play-a-game",     order:  8, estimatedMinutes: 5 },
  { slug: "special-conditions",      title: "Special Conditions and checkup",   module: "play-a-game",     order:  9, estimatedMinutes: 6 },
  { slug: "win-conditions",          title: "Knockouts and how you win",        module: "play-a-game",     order: 10, estimatedMinutes: 6 },

  // ── Unlisted: the post-quiz product tour ──
  { slug: "reading-a-deck-list",     title: "Reading a deck list",              module: "first-deck",      order: 11, estimatedMinutes: 3 },
  { slug: "profile-your-first-deck", title: "Profile your first deck",          module: "first-deck",      order: 12, estimatedMinutes: 3 },
  { slug: "save-to-library",         title: "Save your deck and join the gym",  module: "first-deck",      order: 13, estimatedMinutes: 3 },
];

/** Module ids that make up the graded curriculum, in presentation order. */
export const CURRICULUM_MODULE_IDS: ModuleId[] = modules.map((m) => m.id);

/** True for lessons that appear on the /learn index and count toward the quiz. */
export function isCurriculumLesson(lesson: Lesson): boolean {
  return CURRICULUM_MODULE_IDS.includes(lesson.module);
}

/**
 * The graded curriculum in order — what /learn lists and what "Lesson X of N"
 * counts against. Excludes the unlisted post-quiz tour.
 */
export const curriculumLessons: Lesson[] = lessons
  .filter(isCurriculumLesson)
  .sort((a, b) => a.order - b.order);

/** Total advertised reading time for the graded curriculum, in minutes. */
export const curriculumMinutes: number = curriculumLessons.reduce(
  (sum, l) => sum + l.estimatedMinutes,
  0,
);

/** True when this is the final lesson before the Trainer Quiz. */
export function isLastCurriculumLesson(slug: string): boolean {
  return curriculumLessons[curriculumLessons.length - 1]?.slug === slug;
}

export function getLesson(slug: string): Lesson | undefined {
  return lessons.find((l) => l.slug === slug);
}

export function getModule(id: ModuleId): Module | undefined {
  return modules.find((m) => m.id === id);
}

export function getLessonsByModule(moduleId: ModuleId): Lesson[] {
  return lessons.filter((l) => l.module === moduleId).sort((a, b) => a.order - b.order);
}

export function getNextLesson(slug: string): Lesson | undefined {
  const lesson = getLesson(slug);
  if (!lesson) return undefined;
  return lessons.find((l) => l.order === lesson.order + 1);
}

export function getPreviousLesson(slug: string): Lesson | undefined {
  const lesson = getLesson(slug);
  if (!lesson) return undefined;
  return lessons.find((l) => l.order === lesson.order - 1);
}
