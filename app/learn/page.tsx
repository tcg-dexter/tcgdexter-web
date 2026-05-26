import Link from "next/link";
import type { Metadata } from "next";
import { modules, getLessonsByModule, lessons } from "@/lib/learn/curriculum";

export const metadata: Metadata = {
  title: "Learn to Play | TCG Dexter",
  description:
    "Ten short lessons to learn the Pokémon TCG. By the end you'll have profiled and saved your first deck.",
};

const totalMinutes = lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0);

export default function LearnIndexPage() {
  const orderedModules = [...modules].sort((a, b) => a.order - b.order);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
      <header className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3 leading-tight">
          Learn to Play
          <br />
          Pokémon TCG
        </h1>
        <p className="text-base sm:text-lg text-text-secondary leading-relaxed">
          {lessons.length} short lessons, about {totalMinutes} minutes total. By
          the end, you'll have profiled and saved your first deck on Dexter.
        </p>
      </header>

      <div className="space-y-10">
        {orderedModules.map((mod) => {
          const moduleLessons = getLessonsByModule(mod.id);
          return (
            <section key={mod.id}>
              <div className="mb-4">
                <h2 className="text-lg font-bold text-text-primary">
                  {mod.title}
                </h2>
                <p className="text-sm text-text-muted mt-0.5">
                  {mod.description}
                </p>
              </div>
              <ol className="space-y-2">
                {moduleLessons.map((lesson) => (
                  <li key={lesson.slug}>
                    <Link
                      href={`/learn/${lesson.slug}`}
                      className="flex items-center justify-between gap-3 bg-white border border-border rounded-lg px-4 py-3 card-lift"
                    >
                      <div className="flex items-baseline gap-3 min-w-0">
                        <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                          {String(lesson.order).padStart(2, "0")}
                        </span>
                        <span className="font-medium text-text-primary truncate">
                          {lesson.title}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted shrink-0">
                        {lesson.estimatedMinutes} min
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      <p className="mt-12 text-xs text-text-muted text-center">
        Learn to Play is a v1 preview. More modules — deck building, beginner
        strategy, and getting plugged into the community — are coming soon.
      </p>
    </main>
  );
}
