"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  TrainerSpotlightRow,
  SpotlightCardRef,
  SpotlightPokemonRef,
  SpotlightQA,
} from "@/app/spotlight/types";
import PokemonNamePicker from "./PokemonNamePicker";
import CardSearchPicker from "./CardSearchPicker";

interface DeckOption {
  id: string;
  name: string;
}

interface Props {
  spotlight: TrainerSpotlightRow;
  deckOptions: DeckOption[];
}

export default function EditSpotlightForm({ spotlight, deckOptions }: Props) {
  const router = useRouter();
  const [slug, setSlug] = useState(spotlight.slug);
  const [headline, setHeadline] = useState(spotlight.headline ?? "");
  const [favoritePokemon, setFavoritePokemon] =
    useState<SpotlightPokemonRef | null>(spotlight.favorite_pokemon ?? null);
  const [favoriteCollection, setFavoriteCollection] =
    useState<SpotlightCardRef | null>(spotlight.favorite_collection_card ?? null);
  const [favoriteFormat, setFavoriteFormat] =
    useState<SpotlightCardRef | null>(spotlight.favorite_format_card ?? null);
  const [deckIds, setDeckIds] = useState<string[]>(() => {
    const padded = [...spotlight.featured_deck_ids];
    while (padded.length < 3) padded.push("");
    return padded.slice(0, 3);
  });
  const [qa, setQa] = useState<SpotlightQA[]>(
    spotlight.qa.length > 0 ? spotlight.qa : [{ q: "", a: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  /** Persist current form state. Returns true on success so callers can
   *  chain navigation (e.g. Preview saves then navigates). */
  async function persist(): Promise<boolean> {
    setError(null);
    try {
      const body = {
        slug: slug.trim().toLowerCase(),
        headline: headline.trim() || null,
        favorite_pokemon: favoritePokemon,
        favorite_collection_card: favoriteCollection,
        favorite_format_card: favoriteFormat,
        featured_deck_ids: deckIds.filter(Boolean),
        qa: qa.filter((item) => item.q.trim() || item.a.trim()),
      };
      const res = await fetch(`/api/admin/spotlight/${spotlight.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
  }

  async function onSave() {
    setSaving(true);
    const ok = await persist();
    if (ok) {
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    }
    setSaving(false);
  }

  async function onPreview() {
    setPreviewing(true);
    const ok = await persist();
    if (ok) {
      router.push(`/spotlight/${slug.trim().toLowerCase()}?preview=1`);
    } else {
      setPreviewing(false);
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

      {/* Favorite Pokémon — sprite picker (TeamOfSix-style). */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Favorite Pokémon
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            A Pokémon, rendered as a sprite — independent of any specific card.
          </p>
        </div>
        <PokemonNamePicker
          value={favoritePokemon}
          onChange={setFavoritePokemon}
        />
      </section>

      {/* Favorite cards — shared search drives both slots. */}
      <section className="rounded-2xl bg-white border border-black/8 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Favorite cards
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Search once; each result has buttons to assign it to either slot.
          </p>
        </div>
        <CardSearchPicker
          slots={[
            {
              key: "collection",
              label: "Collection",
              value: favoriteCollection,
              onChange: setFavoriteCollection,
            },
            {
              key: "play",
              label: "Play",
              value: favoriteFormat,
              onChange: setFavoriteFormat,
            },
          ]}
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

      {/* Action bar — capsules: Delete (red outline), Save (black), Preview
          (site gradient). Publish moves to the Preview page so the admin
          always sees the live look before going live. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onDelete}
          disabled={saving || previewing}
          className="text-sm font-semibold px-4 py-2 rounded-full border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50 transition-colors"
        >
          Delete
        </button>
        <div className="flex items-center gap-3 ml-auto">
          {error && <span className="text-xs text-accent">{error}</span>}
          {savedAt && !error && (
            <span className="text-xs text-text-muted">Saved {savedAt}</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || previewing}
            className="text-sm font-semibold px-4 py-2 rounded-full bg-black text-white border border-transparent disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onPreview}
            disabled={saving || previewing}
            className="text-sm font-semibold px-4 py-2 rounded-full text-white bg-gradient-brand border border-transparent shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {previewing ? "Opening…" : "Preview"}
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
