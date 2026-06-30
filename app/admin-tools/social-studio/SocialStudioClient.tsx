"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import LayerCanvas from "./templates/LayerCanvas";
import { buildSpotlightLayers } from "./templates/SpotlightTemplate";
import { buildSpotlightThumbLayers } from "./templates/SpotlightThumbTemplate";
import { buildMetaArchetypeLayers } from "./templates/MetaArchetypeTemplate";
import { buildCardSpotlightLayers } from "./templates/CardSpotlightTemplate";
import { buildFeaturedDeckLayers } from "./templates/FeaturedDeckTemplate";
import { buildFeaturedMatchLayers } from "./templates/FeaturedMatchTemplate";
import { downloadDataUrl, rasterizeLayers, slugify } from "./exportLayers";
import {
  CANVAS_SIZE_BY_KIND,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_LABELS,
  type CardSpotlightSubject,
  type FeaturedDeckSubject,
  type FeaturedMatchSubject,
  type FeaturedManualMatchSubject,
  type MetaArchetypeSubject,
  type SpotlightSubject,
  type SpotlightThumbSubject,
  type StudioLayer,
  type TemplateCopy,
  type TemplateKind,
  type TemplateSubject,
} from "./templates/types";

interface Props {
  spotlights: SpotlightSubject[];
  spotlightThumbs: SpotlightThumbSubject[];
  metaArchetypes: MetaArchetypeSubject[];
  cardSpotlights: CardSpotlightSubject[];
  featuredDecks: FeaturedDeckSubject[];
  featuredMatches: FeaturedMatchSubject[];
  featuredManualMatches: FeaturedManualMatchSubject[];
}

/** Derive a default copy block from the subject. The editor seeds these
 *  on first load + when the user swaps subject in the editor. */
function defaultCopy(subject: TemplateSubject): TemplateCopy {
  switch (subject.kind) {
    case "spotlight":
    case "spotlight_thumb":
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
        subhead: "",
        cta: "Explore the Meta",
      };
    case "card_spotlight":
      return {
        eyebrow: "Card Spotlight",
        headline: subject.name,
        subhead: subject.rarity
          ? `${subject.setName} · ${subject.rarity}`
          : subject.setName,
        cta: "Track the Market",
      };
    case "featured_deck":
      return {
        eyebrow: "Featured Deck",
        headline: subject.name,
        subhead: `Built by @${subject.username}`,
        cta: "View the Deck",
      };
    case "featured_match":
    case "featured_match_manual":
      return {
        eyebrow: "",
        headline: "",
        subhead: "",
        cta: "",
      };
  }
}

/** Which copy fields the inspector should expose for a given template.
 *  Templates that don't render a field on-canvas hide it rather than
 *  letting the user edit dead values (Featured Match renders no editable
 *  copy; Meta Archetype renders its stat block instead of a subhead). */
const COPY_FIELDS_BY_KIND: Record<TemplateKind, (keyof TemplateCopy)[]> = {
  spotlight: ["eyebrow", "headline", "subhead", "cta"],
  spotlight_thumb: ["eyebrow", "headline", "subhead", "cta"],
  meta_archetype: ["eyebrow", "headline", "cta"],
  card_spotlight: ["eyebrow", "headline", "subhead", "cta"],
  featured_deck: ["eyebrow", "headline", "subhead", "cta"],
  featured_match: [],
  featured_match_manual: [],
};

/** Single dispatch point: every template is a layer factory. */
function buildLayers(subject: TemplateSubject, copy: TemplateCopy): StudioLayer[] {
  switch (subject.kind) {
    case "spotlight":
      return buildSpotlightLayers(subject, copy);
    case "spotlight_thumb":
      return buildSpotlightThumbLayers(subject, copy);
    case "meta_archetype":
      return buildMetaArchetypeLayers(subject, copy);
    case "card_spotlight":
      return buildCardSpotlightLayers(subject, copy);
    case "featured_deck":
      return buildFeaturedDeckLayers(subject, copy);
    case "featured_match":
    case "featured_match_manual":
      return buildFeaturedMatchLayers(subject, copy);
  }
}

/** Short, scannable label for a subject in the swap dropdown. */
function subjectLabel(s: TemplateSubject): string {
  switch (s.kind) {
    case "spotlight":
    case "spotlight_thumb":
      return s.displayName;
    case "meta_archetype":
      return s.name;
    case "card_spotlight":
      return `${s.name} · ${s.setName}`;
    case "featured_deck":
      return `${s.name} — @${s.username}`;
    case "featured_match":
    case "featured_match_manual": {
      const left = s.playerHandle ?? `@${s.username}`;
      const right = s.opponentHandle ?? s.opponentArchetype ?? "Opponent";
      return `${left} vs ${right}`;
    }
  }
}

const THUMB_SCALE = 0.18; // 1080 × 0.18 = 194.4px wide
const EDITOR_SCALE = 0.35;

/** Checkerboard backdrop so transparency reads as transparency when the
 *  background layer is hidden or a layer is isolated. */
const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "#fff",
  backgroundImage:
    "linear-gradient(45deg,#e2e2e2 25%,transparent 25%),linear-gradient(-45deg,#e2e2e2 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e2e2 75%),linear-gradient(-45deg,transparent 75%,#e2e2e2 75%)",
  backgroundSize: "28px 28px",
  backgroundPosition: "0 0, 0 14px, 14px -14px, -14px 0",
};

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M4 21h16" />
    </svg>
  );
}

export default function SocialStudioClient({
  spotlights,
  spotlightThumbs,
  metaArchetypes,
  cardSpotlights,
  featuredDecks,
  featuredMatches,
  featuredManualMatches,
}: Props) {
  const subjectsByKind = useMemo(
    () => ({
      spotlight: spotlights,
      spotlight_thumb: spotlightThumbs,
      meta_archetype: metaArchetypes,
      card_spotlight: cardSpotlights,
      featured_deck: featuredDecks,
      featured_match: featuredMatches,
      featured_match_manual: featuredManualMatches,
    }),
    [spotlights, spotlightThumbs, metaArchetypes, cardSpotlights, featuredDecks, featuredMatches, featuredManualMatches],
  );

  const [active, setActive] = useState<TemplateSubject | null>(null);
  const [copy, setCopy] = useState<TemplateCopy | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isolate, setIsolate] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  function openEditor(subject: TemplateSubject) {
    setActive(subject);
    setCopy(defaultCopy(subject));
    setHiddenIds(new Set());
    setSelectedId(null);
    setIsolate(false);
    setActualSize(false);
  }

  function updateCopy(field: keyof TemplateCopy, value: string) {
    setCopy((c) => (c ? { ...c, [field]: value } : c));
  }

  function toggleHidden(id: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Editor view ────────────────────────────────────────────────
  if (active && copy) {
    const scale = actualSize ? 1 : EDITOR_SCALE;
    const size = CANVAS_SIZE_BY_KIND[active.kind];
    const sizeLabel = `${size.w}×${size.h}`;
    const pool = subjectsByKind[active.kind];
    const layers = buildLayers(active, copy);
    const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
    const isolating = isolate && !!selectedLayer;
    const canvasLayers = isolating ? [selectedLayer] : layers;
    const canvasHidden = isolating ? undefined : hiddenIds;
    const visibleLayers = layers.filter((l) => !hiddenIds.has(l.id));
    const exportBase = `${slugify(TEMPLATE_LABELS[active.kind])}--${slugify(subjectLabel(active))}`;
    const busy = exportStatus !== null;

    const exportComposite = async () => {
      setExportStatus("Rendering PNG…");
      try {
        downloadDataUrl(await rasterizeLayers(visibleLayers, size), `${exportBase}.png`);
      } finally {
        setExportStatus(null);
      }
    };

    const exportLayer = async (layer: StudioLayer) => {
      setExportStatus(`Rendering “${layer.name}”…`);
      try {
        const idx = layers.findIndex((l) => l.id === layer.id);
        const nn = String(idx + 1).padStart(2, "0");
        downloadDataUrl(
          await rasterizeLayers([layer], size),
          `${exportBase}__${nn}-${layer.id}.png`,
        );
      } finally {
        setExportStatus(null);
      }
    };

    /** One transparent PNG per visible layer, numbered in paint order so
     *  they re-stack correctly when dropped into animation software. */
    const exportAllLayers = async () => {
      try {
        for (let i = 0; i < visibleLayers.length; i++) {
          const layer = visibleLayers[i];
          setExportStatus(`Layer ${i + 1}/${visibleLayers.length}: ${layer.name}…`);
          const idx = layers.findIndex((l) => l.id === layer.id);
          const nn = String(idx + 1).padStart(2, "0");
          downloadDataUrl(
            await rasterizeLayers([layer], size),
            `${exportBase}__${nn}-${layer.id}.png`,
          );
          // Give the browser a beat between downloads so it doesn't
          // coalesce or drop them.
          await new Promise((r) => setTimeout(r, 350));
        }
      } finally {
        setExportStatus(null);
      }
    };

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

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
            {/* Canvas */}
            <div className="relative">
              <div
                className="rounded-2xl border border-black/8 shadow-sm overflow-hidden mx-auto"
                style={{
                  width: size.w * scale,
                  height: size.h * scale,
                  ...CHECKERBOARD,
                }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: size.w,
                    height: size.h,
                  }}
                >
                  <LayerCanvas
                    layers={canvasLayers}
                    hiddenIds={canvasHidden}
                    width={size.w}
                    height={size.h}
                  />
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-text-muted">
                {isolating
                  ? `Isolating “${selectedLayer!.name}” — this is what the layer PNG will contain.`
                  : actualSize
                    ? `Actual size (${sizeLabel}).`
                    : `Preview at ${Math.round(EDITOR_SCALE * 100)}%. Exports always render at ${sizeLabel}.`}
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
                    if (next) openEditor(next);
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

              {/* Layers panel — top-most layer first, like every layer
                  editor the user has ever opened. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Layers
                  </label>
                  <button
                    onClick={() => setIsolate((v) => !v)}
                    disabled={!selectedLayer}
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                      isolating
                        ? "bg-black text-white border-transparent"
                        : "border-black/15 text-text-secondary disabled:opacity-40"
                    }`}
                  >
                    Isolate
                  </button>
                </div>
                <div className="rounded-lg border border-black/10 bg-white divide-y divide-black/5 overflow-hidden">
                  {[...layers].reverse().map((layer) => {
                    const hidden = hiddenIds.has(layer.id);
                    const selected = selectedId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        onClick={() =>
                          setSelectedId((cur) => (cur === layer.id ? null : layer.id))
                        }
                        className={`flex items-center gap-2 px-2.5 py-2 cursor-pointer text-sm ${
                          selected ? "bg-black/5" : "hover:bg-black/[0.03]"
                        }`}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleHidden(layer.id);
                          }}
                          title={hidden ? "Show layer" : "Hide layer"}
                          className={hidden ? "text-text-muted/50" : "text-text-secondary"}
                        >
                          <EyeIcon off={hidden} />
                        </button>
                        <span
                          className={`flex-1 truncate ${
                            hidden ? "text-text-muted line-through" : "text-text-primary"
                          } ${selected ? "font-semibold" : ""}`}
                        >
                          {layer.name}
                        </span>
                        {layer.copyField && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                            text
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void exportLayer(layer);
                          }}
                          disabled={busy}
                          title="Export this layer as a transparent PNG"
                          className="text-text-muted hover:text-text-primary disabled:opacity-40"
                        >
                          <DownloadIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Copy fields */}
              {COPY_FIELDS_BY_KIND[active.kind].map((field) => (
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

              {/* Export */}
              <div className="pt-2 border-t border-black/8 space-y-2">
                <button
                  onClick={() => void exportComposite()}
                  disabled={busy || visibleLayers.length === 0}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full bg-black text-white border border-transparent disabled:opacity-50"
                >
                  Export PNG ({sizeLabel})
                </button>
                <button
                  onClick={() => void exportAllLayers()}
                  disabled={busy || visibleLayers.length === 0}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full border border-black/15 text-text-primary disabled:opacity-50"
                >
                  Export all layers ({visibleLayers.length} PNGs)
                </button>
                <button
                  onClick={() => setActualSize((v) => !v)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full border border-black/15 text-text-primary"
                >
                  {actualSize ? "Show preview size" : "Show actual size"}
                </button>
                <button
                  onClick={() => setCopy(defaultCopy(active))}
                  disabled={busy}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-full border border-black/15 text-text-primary disabled:opacity-50"
                >
                  Reset copy
                </button>
                {exportStatus ? (
                  <p className="text-[11px] text-text-secondary font-semibold pt-1">
                    {exportStatus}
                  </p>
                ) : (
                  <p className="text-[11px] text-text-muted leading-relaxed pt-1">
                    Layer PNGs export with transparency, numbered in stack
                    order — drop the set into your animation software and
                    they reassemble into this exact frame.
                  </p>
                )}
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
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Social Studio</h1>
            <p className="text-sm text-text-secondary mt-1 max-w-xl">
              A playground for TCG Dexter visuals — social cards built live
              from published content (9:16 stories plus the 5:4 spotlight
              thumbnail). Pick any preview to open the layer editor, then
              export the frame or its individual layers as PNGs.
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
          const tsize = CANVAS_SIZE_BY_KIND[kind];
          return (
            <section key={kind} className="mb-10">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                {TEMPLATE_LABELS[kind]}
              </h2>
              <p className="text-xs text-text-muted mt-0.5 mb-3">
                {TEMPLATE_DESCRIPTIONS[kind]}
              </p>
              {items.length === 0 ? (
                <p className="text-xs text-text-muted italic">
                  No published content available.
                </p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                  {items.map((subject) => (
                    <button
                      key={subject.id}
                      onClick={() => openEditor(subject)}
                      className="group shrink-0 text-left"
                    >
                      <div
                        className="rounded-xl overflow-hidden border border-black/10 bg-white shadow-sm group-hover:shadow-md group-hover:-translate-y-0.5 transition-all"
                        style={{
                          width: tsize.w * THUMB_SCALE,
                          height: tsize.h * THUMB_SCALE,
                        }}
                      >
                        <div
                          style={{
                            transform: `scale(${THUMB_SCALE})`,
                            transformOrigin: "top left",
                            width: tsize.w,
                            height: tsize.h,
                            pointerEvents: "none",
                          }}
                        >
                          <LayerCanvas
                            layers={buildLayers(subject, defaultCopy(subject))}
                            width={tsize.w}
                            height={tsize.h}
                          />
                        </div>
                      </div>
                      <p
                        className="mt-2 text-xs text-text-secondary truncate"
                        style={{ width: tsize.w * THUMB_SCALE }}
                      >
                        {subjectLabel(subject)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
