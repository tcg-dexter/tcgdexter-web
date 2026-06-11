"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import SpotlightTemplate from "./templates/SpotlightTemplate";
import MetaArchetypeTemplate from "./templates/MetaArchetypeTemplate";
import FeaturedDeckTemplate from "./templates/FeaturedDeckTemplate";
import FeaturedMatchTemplate from "./templates/FeaturedMatchTemplate";
import {
  CANVAS_H,
  CANVAS_W,
  TEMPLATE_LABELS,
  type FeaturedDeckSubject,
  type FeaturedMatchSubject,
  type MetaArchetypeSubject,
  type SpotlightSubject,
  type TemplateCopy,
  type TemplateKind,
  type TemplateSubject,
} from "./templates/types";

interface Props {
  spotlights: SpotlightSubject[];
  metaArchetypes: MetaArchetypeSubject[];
  featuredDecks: FeaturedDeckSubject[];
  featuredMatches: FeaturedMatchSubject[];
}

/** Derive a default copy block from the subject. The editor seeds these
 *  on first load + when the user swaps subject in the editor. */
function defaultCopy(subject: TemplateSubject): TemplateCopy {
  switch (subject.kind) {
    case "spotlight":
      return {
        eyebrow: "Trainer Spotlight",
        headline: subject.displayName,
        subhead: subject.headline ?? "Meet this week's featured trainer.",
        cta: "Read the Spotlight",
      };
    case "meta_archetype":
      return {
        eyebrow: "Meta Archetype",
        headline: subject.name,
        subhead: `${subject.representationPct.toFixed(1)}% of the meta`,
        cta: "Explore the Meta",
      };
    case "featured_deck":
      return {
        eyebrow: "Featured Deck",
        headline: subject.name,
        subhead: `Built by @${subject.username}`,
        cta: "View the Deck",
      };
    case "featured_match":
      return {
        eyebrow: "Featured Match",
        headline:
          subject.result === "win"
            ? `@${subject.username} takes the win`
            : subject.result === "loss"
            ? `Tough loss for @${subject.username}`
            : `Hard-fought tie`,
        subhead: subject.opponentArchetype
          ? `vs ${subject.opponentArchetype}`
          : "Logged on TCG Dexter",
        cta: "See the Recap",
      };
  }
}

function renderTemplate(subject: TemplateSubject, copy: TemplateCopy) {
  switch (subject.kind) {
    case "spotlight":
      return <SpotlightTemplate subject={subject} copy={copy} />;
    case "meta_archetype":
      return <MetaArchetypeTemplate subject={subject} copy={copy} />;
    case "featured_deck":
      return <FeaturedDeckTemplate subject={subject} copy={copy} />;
    case "featured_match":
      return <FeaturedMatchTemplate subject={subject} copy={copy} />;
  }
}

/** Short, scannable label for a subject in the swap dropdown. */
function subjectLabel(s: TemplateSubject): string {
  switch (s.kind) {
    case "spotlight":
      return s.displayName;
    case "meta_archetype":
      return s.name;
    case "featured_deck":
      return `${s.name} — @${s.username}`;
    case "featured_match":
      return `@${s.username} ${s.result === "win" ? "W" : s.result === "loss" ? "L" : "T"} vs ${s.opponentArchetype ?? s.opponentHandle ?? "Opponent"}`;
  }
}

const THUMB_SCALE = 0.18; // 1080 × 0.18 = 194.4px wide
const EDITOR_SCALE = 0.35;

export default function SocialStudioClient({
  spotlights,
  metaArchetypes,
  featuredDecks,
  featuredMatches,
}: Props) {
  const subjectsByKind = useMemo(
    () => ({
      spotlight: spotlights,
      meta_archetype: metaArchetypes,
      featured_deck: featuredDecks,
      featured_match: featuredMatches,
    }),
    [spotlights, metaArchetypes, featuredDecks, featuredMatches],
  );

  const [active, setActive] = useState<TemplateSubject | null>(null);
  const [copy, setCopy] = useState<TemplateCopy | null>(null);
  const [actualSize, setActualSize] = useState(false);

  function openEditor(subject: TemplateSubject) {
    setActive(subject);
    setCopy(defaultCopy(subject));
  }

  function swapSubject(subject: TemplateSubject) {
    setActive(subject);
    setCopy(defaultCopy(subject));
  }

  function updateCopy(field: keyof TemplateCopy, value: string) {
    setCopy((c) => (c ? { ...c, [field]: value } : c));
  }

  // ── Editor view ────────────────────────────────────────────────
  if (active && copy) {
    const scale = actualSize ? 1 : EDITOR_SCALE;
    const pool = subjectsByKind[active.kind];
    return (
      <main className="min-h-dvh bg-bg pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setActive(null)}
              className="text-sm font-semibold text-text-secondary hover:text-text-primary inline-flex items-center gap-1"
            >
              ← Back to gallery
            </button>
            <Link
              href="/admin-tools"
              className="text-xs font-semibold text-text-muted hover:text-text-primary"
            >
              Admin Tools
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            {/* Canvas */}
            <div className="relative">
              <div
                className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden mx-auto"
                style={{
                  width: CANVAS_W * scale,
                  height: CANVAS_H * scale,
                }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: CANVAS_W,
                    height: CANVAS_H,
                  }}
                >
                  {renderTemplate(active, copy)}
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-text-muted">
                {actualSize
                  ? "Actual size — use Shift+Cmd+4 → spacebar to capture."
                  : `Preview at ${Math.round(EDITOR_SCALE * 100)}%. Click "Actual size" to capture.`}
              </p>
            </div>

            {/* Inspector */}
            <aside className="space-y-5">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                  Template
                </label>
                <div className="text-sm font-semibold text-text-primary">
                  {TEMPLATE_LABELS[active.kind]}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                  Subject
                </label>
                <select
                  value={active.id}
                  onChange={(e) => {
                    const next = pool.find((p) => p.id === e.target.value);
                    if (next) swapSubject(next);
                  }}
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                >
                  {pool.map((s) => (
                    <option key={s.id} value={s.id}>
                      {subjectLabel(s)}
                    </option>
                  ))}
                </select>
              </div>

              {(["eyebrow", "headline", "subhead", "cta"] as const).map((field) => (
                <div key={field}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                    {field}
                  </label>
                  {field === "headline" || field === "subhead" ? (
                    <textarea
                      value={copy[field]}
                      onChange={(e) => updateCopy(field, e.target.value)}
                      rows={field === "subhead" ? 3 : 2}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm resize-y"
                    />
                  ) : (
                    <input
                      value={copy[field]}
                      onChange={(e) => updateCopy(field, e.target.value)}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}

              <div className="pt-2 border-t border-black/8 space-y-2">
                <button
                  onClick={() => setActualSize((v) => !v)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full bg-black text-white"
                >
                  {actualSize ? "Show preview size" : "Show actual size (1080×1920)"}
                </button>
                <button
                  onClick={() => setCopy(defaultCopy(active))}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full border border-black/15 text-text-primary"
                >
                  Reset copy
                </button>
                <p className="text-[11px] text-text-muted leading-relaxed pt-1">
                  To capture: click <strong>Show actual size</strong>, then
                  press <kbd>Shift</kbd>+<kbd>⌘</kbd>+<kbd>4</kbd>, hit{" "}
                  <kbd>Space</kbd>, and click the canvas window.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    );
  }

  // ── Gallery view ───────────────────────────────────────────────
  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Social Studio</h1>
            <p className="text-sm text-text-secondary mt-1">
              9:16 social card templates pulled live from published content.
            </p>
          </div>
          <Link
            href="/admin-tools"
            className="text-xs font-semibold text-text-muted hover:text-text-primary shrink-0"
          >
            ← Admin Tools
          </Link>
        </header>

        {(Object.keys(subjectsByKind) as TemplateKind[]).map((kind) => {
          const items = subjectsByKind[kind];
          if (items.length === 0) {
            return (
              <section key={kind} className="mb-8">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">
                  {TEMPLATE_LABELS[kind]}
                </h2>
                <p className="text-xs text-text-muted italic">
                  No published content available.
                </p>
              </section>
            );
          }
          return (
            <section key={kind} className="mb-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">
                {TEMPLATE_LABELS[kind]}
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                {items.map((subject) => (
                  <button
                    key={subject.id}
                    onClick={() => openEditor(subject)}
                    className="group shrink-0 text-left"
                  >
                    <div
                      className="rounded-xl overflow-hidden border border-black/10 bg-white shadow-sm group-hover:shadow-md transition-shadow"
                      style={{
                        width: CANVAS_W * THUMB_SCALE,
                        height: CANVAS_H * THUMB_SCALE,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${THUMB_SCALE})`,
                          transformOrigin: "top left",
                          width: CANVAS_W,
                          height: CANVAS_H,
                          pointerEvents: "none",
                        }}
                      >
                        {renderTemplate(subject, defaultCopy(subject))}
                      </div>
                    </div>
                    <p
                      className="mt-2 text-xs text-text-secondary truncate"
                      style={{ width: CANVAS_W * THUMB_SCALE }}
                    >
                      {subjectLabel(subject)}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
