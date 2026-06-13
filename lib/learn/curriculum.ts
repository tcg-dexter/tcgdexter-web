// Curriculum metadata for Trainer School v1.
//
// Lesson bodies live in app/learn/(content)/<slug>.mdx. This file defines the
// order, module grouping, and metadata used by the /learn index page and the
// lesson renderer once the scaffolding lands.

export type ModuleId = "basics" | "first-deck";

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

export const modules: Module[] = [
  {
    id: "basics",
    title: "The Basics",
    description: "Cards, turns, and how a game of Pokémon TCG is won.",
    order: 1,
  },
];

// "first-deck" module lessons are kept here so existing routes
// (/learn/reading-a-deck-list, etc.) and the post-quiz CTA still work, but
// the module itself is no longer presented on the /learn index.
export const lessons: Lesson[] = [
  { slug: "what-is-pokemon-tcg",     title: "Say Hello to Pokémon TCG",        module: "basics",     order: 1, estimatedMinutes: 3 },
  { slug: "anatomy-pokemon-card",    title: "Anatomy of a Pokémon card",       module: "basics",     order: 2, estimatedMinutes: 4 },
  { slug: "anatomy-trainer-card",    title: "Anatomy of a Trainer card",       module: "basics",     order: 3, estimatedMinutes: 3 },
  { slug: "anatomy-energy-card",     title: "Anatomy of an Energy card",       module: "basics",     order: 4, estimatedMinutes: 3 },
  { slug: "how-a-turn-works",        title: "How a turn works",                module: "basics",     order: 5, estimatedMinutes: 4 },
  { slug: "win-conditions",          title: "How to Win",                      module: "basics",     order: 6, estimatedMinutes: 6 },
  { slug: "reading-a-deck-list",     title: "Reading a deck list",             module: "first-deck", order: 7, estimatedMinutes: 3 },
  { slug: "profile-your-first-deck", title: "Profile your first deck",         module: "first-deck", order: 8, estimatedMinutes: 3 },
  { slug: "save-to-library",         title: "Save your deck and join the gym", module: "first-deck", order: 9, estimatedMinutes: 3 },
];

export function getLesson(slug: string): Lesson | undefined {
  return lessons.find((l) => l.slug === slug);
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
