import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import matter from "gray-matter";
import TrackView from "@/app/components/TrackView";
import {
  lessons,
  getLesson,
  getLessonsByModule,
  getNextLesson,
  getPreviousLesson,
} from "@/lib/learn/curriculum";

export const dynamicParams = false;

export function generateStaticParams() {
  return lessons.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const lesson = getLesson(params.slug);
  if (!lesson) return {};
  return {
    title: `${lesson.title} | Learn to Play`,
    description: `${lesson.title} — a Learn to Play lesson on TCG Dexter.`,
  };
}

/* Tailwind-tokened MDX component overrides. The lesson MDX files are plain
   markdown today (no custom components), so we only need to style the basic
   element set: headings, paragraphs, lists, code, links, images. */
const mdxComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1
      className="text-3xl font-bold text-text-primary mt-2 mb-5 leading-tight"
      {...props}
    />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="text-xl font-bold text-text-primary mt-8 mb-3"
      {...props}
    />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="text-lg font-semibold text-text-primary mt-6 mb-2"
      {...props}
    />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="leading-relaxed mb-4 text-text-secondary"
      {...props}
    />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="list-disc pl-6 mb-4 space-y-1.5 text-text-secondary marker:text-text-muted"
      {...props}
    />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol
      className="list-decimal pl-6 mb-4 space-y-1.5 text-text-secondary marker:text-text-muted"
      {...props}
    />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="text-text-primary font-semibold" {...props} />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em className="italic" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLElement>) => (
    <blockquote
      className="border-l-2 border-accent pl-4 my-4 text-text-secondary italic"
      {...props}
    />
  ),
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-8 border-border" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="bg-white border border-border rounded-lg p-4 overflow-x-auto text-xs sm:text-sm font-mono text-text-primary mb-5 leading-relaxed dark:bg-surface-2"
      {...props}
    />
  ),
  code: ({
    className,
    ...rest
  }: React.HTMLAttributes<HTMLElement> & { className?: string }) =>
    className ? (
      // Fenced block — let <pre> styling wrap us.
      <code className={className} {...rest} />
    ) : (
      <code
        className="bg-surface px-1.5 py-0.5 rounded text-[0.9em] font-mono text-text-primary"
        {...rest}
      />
    ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      className="text-accent hover:text-accent-dark underline underline-offset-2"
      {...props}
    />
  ),
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      className="rounded-lg my-5 mx-auto max-w-[220px] warm-shadow"
      loading="lazy"
      {...props}
    />
  ),
};

export default async function LessonPage({
  params,
}: {
  params: { slug: string };
}) {
  const lesson = getLesson(params.slug);
  if (!lesson) notFound();

  const filePath = path.join(
    process.cwd(),
    "app/learn/(content)",
    `${params.slug}.mdx`,
  );

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    notFound();
  }

  const { content: body } = matter(raw);
  const { content: mdx } = await compileMDX({
    source: body,
    components: mdxComponents,
  });

  const prev = getPreviousLesson(params.slug);
  const next = getNextLesson(params.slug);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 sm:py-12">
      <TrackView event="learn.lesson_viewed" properties={{ slug: params.slug }} />
      <nav className="text-xs text-text-muted mb-6 flex items-center gap-2 flex-wrap">
        <Link href="/learn" className="hover:text-text-secondary">
          Learn to Play
        </Link>
        <span aria-hidden>›</span>
        <span>
          Lesson {lesson.order} of {lessons.length}
        </span>
        <span className="ml-auto">{lesson.estimatedMinutes} min read</span>
      </nav>

      <article>{mdx}</article>

      {(() => {
        const basicsLessons = getLessonsByModule("basics");
        const isBasicsEnd =
          lesson.module === "basics" &&
          lesson.order === basicsLessons[basicsLessons.length - 1].order;
        const isLast = !next;

        const backHref = prev ? `/learn/${prev.slug}` : "/learn";

        /* Three routing outcomes after a lesson:
           - End of the "basics" module → Trainer Quiz
           - Final lesson overall (last of "first-deck") → Profile a deck
           - Anything else → next lesson in order */
        let nextHref: string;
        let nextLabel: string;
        let nextContextItem: { href: string; label: string; order: number | null };
        let footerCaption: string | null = null;

        if (isBasicsEnd) {
          nextHref = "/learn/quiz";
          nextLabel = "Take the quiz";
          nextContextItem = {
            href: "/learn/quiz",
            label: "Certified Trainer quiz",
            order: null,
          };
          footerCaption = "Take the quiz to earn your Certified Trainer Badge";
        } else if (isLast) {
          nextHref = "/";
          nextLabel = "Profile a deck";
          nextContextItem = {
            href: "/",
            label: "Profile your first deck",
            order: null,
          };
        } else {
          nextHref = `/learn/${next!.slug}`;
          nextLabel = "Next";
          nextContextItem = {
            href: `/learn/${next!.slug}`,
            label: next!.title,
            order: next!.order,
          };
        }

        return (
          <>
            <nav
              aria-label="Lesson context"
              className="mt-10 pt-6 border-t border-border"
            >
              <ol className="space-y-2">
                {prev && (
                  <li>
                    <Link
                      href={`/learn/${prev.slug}`}
                      className="flex items-baseline gap-3 px-3 py-2 rounded-lg opacity-50 hover:opacity-100 hover:bg-white transition-all dark:hover:bg-surface-2"
                    >
                      <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                        {String(prev.order).padStart(2, "0")}
                      </span>
                      <span className="text-sm text-text-secondary truncate">
                        {prev.title}
                      </span>
                    </Link>
                  </li>
                )}
                <li>
                  <div className="flex items-baseline gap-3 px-3 py-2 rounded-lg bg-white border border-border dark:bg-surface-2">
                    <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                      {String(lesson.order).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-semibold text-text-primary truncate">
                      {lesson.title}
                    </span>
                    <span className="ml-auto text-xs text-text-secondary opacity-50 shrink-0">
                      Current
                    </span>
                  </div>
                </li>
                <li>
                  <Link
                    href={nextContextItem.href}
                    className="flex items-baseline gap-3 px-3 py-2 rounded-lg opacity-50 hover:opacity-100 hover:bg-white transition-all dark:hover:bg-surface-2"
                  >
                    <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                      {nextContextItem.order !== null
                        ? String(nextContextItem.order).padStart(2, "0")
                        : "→"}
                    </span>
                    <span className="text-sm text-text-secondary truncate">
                      {nextContextItem.label}
                    </span>
                  </Link>
                </li>
              </ol>
            </nav>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link
                href={backHref}
                className="relative flex items-center justify-center rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85"
              >
                <svg
                  className="absolute left-5 w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back
              </Link>
              <Link
                href={nextHref}
                className="relative flex items-center justify-center rounded-full bg-gradient-brand px-5 py-2.5 text-sm font-semibold text-white shadow-brand hover:shadow-brand-lg transition"
              >
                {nextLabel}
                <svg
                  className="absolute right-5 w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>

            {footerCaption && (
              <p className="mt-4 text-center text-sm text-text-secondary">
                {footerCaption}
              </p>
            )}
          </>
        );
      })()}
    </main>
  );
}
