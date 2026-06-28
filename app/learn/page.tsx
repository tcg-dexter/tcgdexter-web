import Link from "next/link";
import type { Metadata } from "next";
import TrackView from "@/app/components/TrackView";
import { lessons, modules } from "@/lib/learn/curriculum";
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
  // Filter lessons to only those whose module is still presented on the
  // index. (The first-deck lessons remain routable for the post-quiz CTA.)
  const visibleModuleIds = new Set(modules.map((m) => m.id));
  const visibleLessons = lessons
    .filter((l) => visibleModuleIds.has(l.module))
    .sort((a, b) => a.order - b.order);

  const totalMinutes = visibleLessons.reduce(
    (sum, l) => sum + l.estimatedMinutes,
    0,
  );

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
          {visibleLessons.length} short lessons, about {totalMinutes} minutes
          total.
        </p>
      </header>

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleLessons.map((lesson, i) => (
          <li key={lesson.slug}>
            <Link
              href={`/learn/${lesson.slug}`}
              className="relative flex flex-col h-full rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow"
              style={{
                background: gradientFor(i),
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

      <p className="mt-12 text-xs text-text-muted text-center">
        Learn to Play is a v1 preview. More modules — deck building, beginner
        strategy, and getting plugged into the community — are coming soon.
      </p>
    </main>
  );
}
