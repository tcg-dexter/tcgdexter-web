import Link from "next/link";
import type { Metadata } from "next";
import TrackView from "@/app/components/TrackView";
import {
  modules,
  curriculumLessons,
  curriculumMinutes,
  getLessonsByModule,
} from "@/lib/learn/curriculum";
import { TYPE_COLOR } from "@/lib/metaPrimaryCard";
import { shade } from "@/lib/color";

export const metadata: Metadata = {
  title: "Learn to Play | TCG Dexter",
  description:
    "Short lessons to learn the Pokémon TCG — cards, turns, and how to win.",
};

// Soft pastel pairs sampled from the battle-preview TYPE_COLOR palette,
// lightened by +30% so the cell reads as a soft gradient with dark text.
// One pair per lesson, cycling if more lessons than pairs.
const GRADIENT_PAIRS: [keyof typeof TYPE_COLOR, keyof typeof TYPE_COLOR][] = [
  ["Fire", "Lightning"],
  ["Grass", "Water"],
  ["Psychic", "Fairy"],
  ["Lightning", "Fighting"],
  ["Water", "Darkness"],
  ["Fire", "Psychic"],
  ["Dragon", "Grass"],
  ["Fairy", "Water"],
  ["Metal", "Lightning"],
];

function gradientFor(index: number): string {
  const [a, b] = GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
  return `linear-gradient(135deg, ${shade(TYPE_COLOR[a], 30)} 0%, ${shade(TYPE_COLOR[b], 30)} 100%)`;
}

export default function LearnIndexPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <TrackView event="learn.index_viewed" />
      <header className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3 leading-tight">
          Learn to Play
          <br />
          Pokémon TCG
        </h1>
        <p className="text-base sm:text-lg text-text-secondary leading-relaxed">
          {curriculumLessons.length} lessons, about {curriculumMinutes} minutes
          total. By the end you&rsquo;ll be able to sit down and play a real
          game — then take the Trainer Quiz for your badge.
        </p>
      </header>

      {modules.map((mod) => {
        const modLessons = getLessonsByModule(mod.id);
        return (
          <section key={mod.id} className="mb-10 last:mb-0">
            <header className="mb-3">
              <h2 className="text-xl font-bold text-text-primary">
                <span className="text-text-muted font-mono text-base mr-2 tabular-nums">
                  {String(mod.order).padStart(2, "0")}
                </span>
                {mod.title}
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                {mod.description}
              </p>
            </header>

            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {modLessons.map((lesson) => (
                <li key={lesson.slug}>
                  <Link
                    href={`/learn/${lesson.slug}`}
                    className="relative flex flex-col h-full rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow"
                    style={{
                      // Index by lesson order so each lesson keeps a stable
                      // colour regardless of which module it sits in.
                      background: gradientFor(lesson.order - 1),
                      aspectRatio: "5 / 3",
                    }}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-primary/60">
                      <span>Lesson {String(lesson.order).padStart(2, "0")}</span>
                      <span>{lesson.estimatedMinutes} min</span>
                    </div>
                    <h3 className="mt-auto text-2xl sm:text-3xl font-bold text-text-primary leading-tight">
                      {lesson.title}
                    </h3>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      <p className="mt-12 text-xs text-text-muted text-center">
        Finish all {curriculumLessons.length} lessons, then take the{" "}
        <Link href="/learn/quiz" className="text-accent hover:underline">
          Trainer Quiz
        </Link>{" "}
        to earn your Certified Trainer badge.
      </p>
    </main>
  );
}
