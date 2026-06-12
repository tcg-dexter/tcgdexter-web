"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  TrainerSpotlightRow,
  SpotlightCardRef,
  SpotlightQA,
} from "@/app/spotlight/types";
import CardSearchPicker from "./CardSearchPicker";

interface DeckOption {
  id: string;
  name: string;
}

interface Props {
  spotlight: TrainerSpotlightRow;
  deckOptions: DeckOption[];
}

function emptyCard(): SpotlightCardRef {
  return { set_id: "", number: "", name: "" };
}

export default function EditSpotlightForm({ spotlight, deckOptions }: Props) {
  const router = useRouter();
  const [slug, setSlug] = useState(spotlight.slug);
  const [headline, setHeadline] = useState(spotlight.headline ?? "");
  const [favoritePokemon, setFavoritePokemon] = useState<SpotlightCardRef>(
    spotlight.favorite_pokemon ?? emptyCard()
  );
  const [favoriteCollection, setFavoriteCollection] = useState<SpotlightCardRef>(
    spotlight.favorite_collection_card ?? emptyCard()
  );
  const [favoriteFormat, setFavoriteFormat] = useState<SpotlightCardRef>(
    spotlight.favorite_format_card ?? emptyCard()
  );
  const [deckIds, setDeckIds] = useState<string[]>(() => {
    const padded = [...spotlight.featured_deck_ids];
    while (padded.length < 3) padded.push("");
    return padded.slice(0, 3);
  });
  const [qa, setQa] = useState<SpotlightQA[]>(
    spotlight.qa.length > 0 ? spotlight.qa : [{ q: "", a: "" }]
  );
  const [isPublished, setIsPublished] = useState(spotlight.is_published);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function nullIfEmpty(c: SpotlightCardRef): SpotlightCardRef | null {
    if (!c.set_id && !c.number && !c.name) return null;
    return c;
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        slug: slug.trim().toLowerCase(),
        headline: headline.trim() || null,
        favorite_pokemon: nullIfEmpty(favoritePokemon),
        favorite_collection_card: nullIfEmpty(favoriteCollection),
        favorite_format_card: nullIfEmpty(favoriteFormat),
        featured_deck_ids: deckIds.filter(Boolean),
        qa: qa.filter((item) => item.q.trim() || item.a.trim()),
        is_published: isPublished,
      };
      const res = await fetch(`/api/admin/spotlight/${spotlight.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm("Delete this spotlight? This cannot be undone.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/spotlight/${spotlight.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/admin/spotlight");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Basics */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-4">
        <Field label="Slug">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Headline">
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="One-line tagline shown under the name"
            className="input"
          />
        </Field>
      </section>

      {/* Favorite cards */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">Favorite cards</h3>
        <CardSearchPicker
          label="Favorite Pokémon"
          value={favoritePokemon}
          onChange={setFavoritePokemon}
        />
        <CardSearchPicker
          label="Favorite in Collection"
          value={favoriteCollection}
          onChange={setFavoriteCollection}
        />
        <CardSearchPicker
          label="Favorite to Play"
          value={favoriteFormat}
          onChange={setFavoriteFormat}
        />
      </section>

      {/* Featured decks */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Featured decks (up to 3)
        </h3>
        {[0, 1, 2].map((i) => (
          <select
            key={i}
            value={deckIds[i] ?? ""}
            onChange={(e) => {
              const next = [...deckIds];
              next[i] = e.target.value;
              setDeckIds(next);
            }}
            className="input"
          >
            <option value="">— none —</option>
            {deckOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ))}
        {deckOptions.length === 0 && (
          <p className="text-xs text-text-muted">
            This user has no saved decks yet.
          </p>
        )}
      </section>

      {/* Q&A */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Q&amp;A</h3>
        {qa.map((item, i) => (
          <div key={i} className="space-y-2 border-t border-black/8 pt-3 first:border-t-0 first:pt-0">
            <input
              value={item.q}
              onChange={(e) => {
                const next = [...qa];
                next[i] = { ...item, q: e.target.value };
                setQa(next);
              }}
              placeholder="Question"
              className="input"
            />
            <textarea
              value={item.a}
              onChange={(e) => {
                const next = [...qa];
                next[i] = { ...item, a: e.target.value };
                setQa(next);
              }}
              placeholder="Answer"
              rows={3}
              className="input"
            />
            <button
              type="button"
              onClick={() => setQa(qa.filter((_, idx) => idx !== i))}
              className="text-xs text-text-muted hover:text-accent"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setQa([...qa, { q: "", a: "" }])}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-black/15 hover:bg-[var(--surface)]"
        >
          + Add question
        </button>
      </section>

      {/* Publish */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          Published
        </label>
      </section>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50"
        >
          Delete
        </button>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-accent">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs text-text-muted">Saved {savedAt}</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-black text-white border border-transparent disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(0, 0, 0, 0.15);
          background: white;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
