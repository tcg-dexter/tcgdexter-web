import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { serialize } from "next-mdx-remote/serialize";
import { LESSON_MDX_OPTIONS } from "./mdx-options";
import {
  lessons,
  modules,
  curriculumLessons,
  curriculumMinutes,
  isLastCurriculumLesson,
  getLesson,
  getNextLesson,
  getPreviousLesson,
} from "./curriculum";
import { QUESTIONS, QUIZ_LENGTH, PASSING_SCORE, gradeAnswers } from "@/app/learn/quiz/questions";
import { getCardById } from "@/lib/cardsIndex";
import { isStandardMark } from "@/lib/cardPrinting";

const CONTENT_DIR = path.join(process.cwd(), "app/learn/(content)");

function readLesson(slug: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${slug}.mdx`), "utf8");
}

/** Every `<Card id="..." />` and `<CardAnatomy id="..." ...>` in the lessons. */
function cardIdsIn(body: string): string[] {
  // Array.from rather than spread — the repo's TS target predates
  // downlevelIteration, so spreading a RegExpStringIterator won't compile.
  return Array.from(body.matchAll(/<Card(?:Anatomy)?\s[^>]*?id="([^"]+)"/g), (m) => m[1]);
}

describe("curriculum ↔ content parity", () => {
  const mdxSlugs = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));

  it("every lesson has a matching .mdx file", () => {
    const missing = lessons.filter((l) => !mdxSlugs.includes(l.slug)).map((l) => l.slug);
    expect(missing).toEqual([]);
  });

  it("every .mdx file has a matching lesson", () => {
    const orphans = mdxSlugs.filter((s) => !getLesson(s));
    expect(orphans).toEqual([]);
  });

  it("frontmatter slug and title match curriculum.ts", () => {
    // Frontmatter is discarded by the renderer, so drift is silent — this is
    // the only thing stopping the two from disagreeing.
    for (const lesson of lessons) {
      const { data } = matter(readLesson(lesson.slug));
      expect(data.slug, `${lesson.slug} frontmatter slug`).toBe(lesson.slug);
      expect(data.title, `${lesson.slug} frontmatter title`).toBe(lesson.title);
    }
  });

  it("frontmatter carries no fields that would silently do nothing", () => {
    for (const lesson of lessons) {
      const { data } = matter(readLesson(lesson.slug));
      expect(Object.keys(data).sort(), `${lesson.slug} frontmatter keys`).toEqual([
        "slug",
        "title",
      ]);
    }
  });
});

describe("lesson ordering", () => {
  it("orders are unique", () => {
    const orders = lessons.map((l) => l.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("orders are contiguous from 1", () => {
    const sorted = [...lessons].map((l) => l.order).sort((a, b) => a - b);
    expect(sorted).toEqual(sorted.map((_, i) => i + 1));
  });

  it("the graded curriculum comes before the unlisted tour", () => {
    const lastCurriculum = Math.max(...curriculumLessons.map((l) => l.order));
    const unlisted = lessons.filter((l) => !curriculumLessons.includes(l));
    for (const l of unlisted) expect(l.order).toBeGreaterThan(lastCurriculum);
  });

  it("next/previous chain across every lesson", () => {
    const ordered = [...lessons].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ordered.length; i++) {
      expect(getNextLesson(ordered[i].slug)?.slug).toBe(ordered[i + 1]?.slug);
      expect(getPreviousLesson(ordered[i].slug)?.slug).toBe(ordered[i - 1]?.slug);
    }
  });

  it("exactly one lesson is the end of the graded curriculum", () => {
    const ends = lessons.filter((l) => isLastCurriculumLesson(l.slug));
    expect(ends.map((l) => l.slug)).toEqual(["win-conditions"]);
  });

  it("every module in `modules` has at least one lesson", () => {
    for (const m of modules) {
      expect(lessons.some((l) => l.module === m.id), `module ${m.id}`).toBe(true);
    }
  });

  it("advertises a sane total reading time", () => {
    expect(curriculumLessons).toHaveLength(10);
    expect(curriculumMinutes).toBe(
      curriculumLessons.reduce((n, l) => n + l.estimatedMinutes, 0),
    );
  });
});

describe("quiz alignment", () => {
  it("asks exactly QUIZ_LENGTH questions", () => {
    expect(QUESTIONS).toHaveLength(QUIZ_LENGTH);
  });

  it("every sourceLesson resolves to a real lesson", () => {
    for (const q of QUESTIONS) {
      expect(getLesson(q.sourceLesson), `question ${q.id} → ${q.sourceLesson}`).toBeDefined();
    }
  });

  it("covers each graded lesson exactly once", () => {
    const covered = QUESTIONS.map((q) => q.sourceLesson).sort();
    expect(covered).toEqual(curriculumLessons.map((l) => l.slug).sort());
  });

  it("every answerIndex is inside its options array", () => {
    for (const q of QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(q.options.length);
    }
  });

  it("grades a perfect run as a pass and a wrong run as a fail", () => {
    const perfect = QUESTIONS.map((q) => q.answerIndex);
    expect(gradeAnswers(perfect)).toBe(PASSING_SCORE);

    const oneWrong = [...perfect];
    oneWrong[0] = (oneWrong[0] + 1) % QUESTIONS[0].options.length;
    expect(gradeAnswers(oneWrong)).toBe(PASSING_SCORE - 1);
  });

  it("rejects malformed submissions instead of scoring them", () => {
    expect(gradeAnswers([])).toBe(0);
    expect(gradeAnswers(QUESTIONS.map(() => 0).slice(0, 5))).toBe(0);
  });
});

describe("MDX compiles with the props the lessons rely on", () => {
  // next-mdx-remote v6 strips JSX expression attributes by default, which made
  // every <Check>/<CardAnatomy> render with undefined props — no error, no
  // warning, just a blank component and a crash on the first `.map`. These
  // compile each lesson through the exact options the route uses and assert
  // the expression props survive into the compiled output.
  it("every lesson compiles without throwing", async () => {
    for (const lesson of lessons) {
      await expect(
        serialize(readLesson(lesson.slug), LESSON_MDX_OPTIONS),
        `${lesson.slug} should compile`,
      ).resolves.toBeTruthy();
    }
  });

  it("keeps expression props like options={[…]} and answer={n}", async () => {
    const withCheck = lessons.filter((l) => /<Check\b/.test(readLesson(l.slug)));
    expect(withCheck.length).toBeGreaterThan(0);

    for (const lesson of withCheck) {
      const { compiledSource } = await serialize(
        readLesson(lesson.slug),
        LESSON_MDX_OPTIONS,
      );
      expect(compiledSource, `${lesson.slug} <Check options>`).toMatch(/options:\s*\[/);
      expect(compiledSource, `${lesson.slug} <Check answer>`).toMatch(/answer:\s*\d/);
    }
  });

  it("keeps the parts array on the annotated card", async () => {
    const lesson = lessons.find((l) => /<CardAnatomy\b/.test(readLesson(l.slug)));
    expect(lesson, "a lesson should use <CardAnatomy>").toBeDefined();

    const { compiledSource } = await serialize(
      readLesson(lesson!.slug),
      LESSON_MDX_OPTIONS,
    );
    expect(compiledSource).toMatch(/parts:\s*\[/);
  });

  it("would fail under the default hardening — proving the guard is real", async () => {
    const lesson = lessons.find((l) => /<Check\b/.test(readLesson(l.slug)))!;
    const { compiledSource } = await serialize(readLesson(lesson.slug), {
      blockJS: true,
    });
    expect(compiledSource).not.toMatch(/options:\s*\[/);
  });
});

describe("lesson board", () => {
  const BOARD_PATH = path.join(process.cwd(), "app/learn/components/Board.tsx");
  const boardSrc = fs.readFileSync(BOARD_PATH, "utf8");

  it("renders the shared replay mat rather than a diagram of its own", () => {
    // The whole point of the board is that it IS the mat the replay viewer
    // draws — a lookalike diagram would have to be re-synced by hand every
    // time the real board moves, which is how the last one went stale.
    expect(boardSrc).toMatch(/from "@\/app\/admin-tools\/replay\/BoardKit"/);
    expect(boardSrc).toMatch(/<PlayerMat\b/);
  });

  it("every <Board stage> a lesson asks for is a scene the board defines", () => {
    // Board falls back to the midgame scene for an unknown stage, so a typo
    // here renders the wrong board silently rather than failing.
    const known = Array.from(
      (boardSrc.match(/const SCENES: Record<([^>]+),/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (m) => m[1],
    );
    expect(known.length, "should find the scene names in Board.tsx").toBeGreaterThan(0);

    for (const lesson of lessons) {
      const asked = Array.from(
        readLesson(lesson.slug).matchAll(/<Board\s[^>]*?stage="([^"]*)"/g),
        (m) => m[1],
      );
      for (const stage of asked) {
        expect(known, `${lesson.slug} asks for stage="${stage}"`).toContain(stage);
      }
    }
  });
});

describe("card references", () => {
  it("every card id used in a lesson resolves in the card index", () => {
    const bad: string[] = [];
    for (const lesson of lessons) {
      for (const id of cardIdsIn(readLesson(lesson.slug))) {
        if (!getCardById(id)) bad.push(`${lesson.slug}: ${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every card shown in a lesson is Standard-legal", () => {
    // Lessons teach the current Standard format, so a rotated printing on the
    // page is a factual error — a beginner would copy a card they can't play.
    // `isStandardMark` is the same authority the deck analyzer uses, so this
    // tightens automatically at the next rotation instead of drifting.
    const offenders: string[] = [];
    for (const lesson of lessons) {
      for (const id of cardIdsIn(readLesson(lesson.slug))) {
        const card = getCardById(id);
        if (!card) continue; // absence is the previous test's job
        // Basic Energy is printed without a regulation mark and never
        // rotates — its legality comes from a separate rule. Every one of
        // the 16 Basic Darkness Energy printings in the catalog is unmarked,
        // so there is no "marked" alternative to prefer here.
        const isBasicEnergy =
          card.supertype === "Energy" && card.subtypes.includes("Basic");
        if (isBasicEnergy) continue;
        if (!isStandardMark(card.regulationMark)) {
          offenders.push(
            `${lesson.slug}: ${id} ${card.name} (mark ${card.regulationMark ?? "none"})`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no lesson inlines a raw card-image URL", () => {
    // Hardcoded hosts bypass the per-set CDN routing in lib/cardImages.ts and
    // break silently for any set that host doesn't index — which is how the
    // Mega Evolution images in the Trainer lesson broke. Use <Card id=…>.
    const offenders = lessons.filter((l) =>
      /https:\/\/images\.pokemontcg\.io|limitlesstcg|images\.scrydex/.test(
        readLesson(l.slug),
      ),
    );
    expect(offenders.map((l) => l.slug)).toEqual([]);
  });
});
