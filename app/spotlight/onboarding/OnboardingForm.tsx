"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PokemonNamePicker from "@/app/admin/spotlight/[id]/edit/PokemonNamePicker";
import CardSearchPicker from "@/app/admin/spotlight/[id]/edit/CardSearchPicker";
import {
  MAX_ANSWERS,
  MAX_FAVORITE_CARDS,
  MAX_FEATURED_DECKS,
  MIN_ANSWERS,
  SPOTLIGHT_QUESTIONS,
} from "../questions";
import type {
  SpotlightCardRef,
  SpotlightPokemonRef,
  SpotlightSubmission,
  SpotlightSubmissionStatus,
} from "../types";
import SubmissionAvatarUploader from "./SubmissionAvatarUploader";

interface DeckOption {
  id: string;
  name: string;
}

interface ListOption {
  short_id: string;
  name: string;
}

interface Props {
  initialSubmission: SpotlightSubmission;
  status: SpotlightSubmissionStatus;
  deckOptions: DeckOption[];
  listOptions: ListOption[];
}

/** Answers are keyed by question text, matching the SpotlightQA shape the
 *  published `qa` column uses. This maps a question id to its text so a
 *  stored answer can be matched back to its checkbox. */
function questionText(id: string): string {
  return SPOTLIGHT_QUESTIONS.find((q) => q.id === id)?.q ?? "";
}

/**
 * The featured trainer's onboarding form — a direct translation of the
 * Trainer Spotlight prep PDF into the site.
 *
 * Answers are held in local state and saved whole via
 * PUT /api/spotlight/onboarding, following the manual-save convention the
 * admin editor uses (Save, then a "Saved HH:MM" stamp) rather than autosaving.
 * Submitting is a separate, explicit action.
 */
export default function OnboardingForm({
  initialSubmission,
  status,
  deckOptions,
  listOptions,
}: Props) {
  const router = useRouter();
  const readOnly = status === "in_review" || status === "approved";

  const [headline, setHeadline] = useState(initialSubmission.headline);
  const [intro, setIntro] = useState(initialSubmission.intro);
  const [notes, setNotes] = useState(initialSubmission.notes);
  const [pokemon, setPokemon] = useState<SpotlightPokemonRef | null>(
    initialSubmission.favorite_pokemon,
  );
  const [collectionCards, setCollectionCards] = useState<SpotlightCardRef[]>(
    initialSubmission.collection_cards,
  );
  const [playCards, setPlayCards] = useState<SpotlightCardRef[]>(
    initialSubmission.play_cards,
  );
  const [deckIds, setDeckIds] = useState<string[]>(() => {
    const padded = [...initialSubmission.deck_ids];
    while (padded.length < MAX_FEATURED_DECKS) padded.push("");
    return padded.slice(0, MAX_FEATURED_DECKS);
  });
  const [listIds, setListIds] = useState<string[]>(
    initialSubmission.list_short_ids,
  );
  const [avatarUrl, setAvatarUrl] = useState(
    initialSubmission.avatar_upload_url,
  );

  // Answers keyed by question id. A question is "selected" when it has an
  // entry, even an empty one, so checking a box reveals its textarea.
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const item of initialSubmission.answers) {
      const match = SPOTLIGHT_QUESTIONS.find((q) => q.q === item.q);
      if (match) map[match.id] = item.a;
    }
    return map;
  });

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const selectedIds = useMemo(() => Object.keys(answers), [answers]);
  const answeredCount = useMemo(
    () => selectedIds.filter((id) => answers[id].trim()).length,
    [selectedIds, answers],
  );
  const canSubmit = intro.trim().length > 0 && answeredCount >= MIN_ANSWERS;

  function toggleQuestion(id: string) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (id in next) {
        delete next[id];
      } else {
        if (Object.keys(next).length >= MAX_ANSWERS) return prev;
        next[id] = "";
      }
      return next;
    });
  }

  function buildSubmission(): SpotlightSubmission {
    return {
      headline,
      intro,
      favorite_pokemon: pokemon,
      collection_cards: collectionCards,
      play_cards: playCards,
      // Preserve the bank's order rather than click order, so the admin reads
      // them in the same sequence every time.
      answers: SPOTLIGHT_QUESTIONS.filter(
        (q) => q.id in answers && answers[q.id].trim(),
      ).map((q) => ({ q: q.q, a: answers[q.id].trim() })),
      deck_ids: deckIds.filter(Boolean),
      list_short_ids: listIds,
      avatar_upload_url: avatarUrl,
      notes,
    };
  }

  async function persist(submit: boolean): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/spotlight/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission: buildSubmission(), submit }),
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
    if (await persist(false)) setSavedAt(new Date().toLocaleTimeString());
    setSaving(false);
  }

  async function onSubmit() {
    if (
      !confirm(
        "Send this to TCG Dexter? You can still make changes afterwards, up until the editing pass starts.",
      )
    ) {
      return;
    }
    setSubmitting(true);
    if (await persist(true)) router.refresh();
    setSubmitting(false);
  }

  if (readOnly) {
    return (
      <p className="text-sm text-text-secondary">
        Your answers are locked while the spotlight is being edited. If you need
        something changed, leave a note when you review it.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {status === "submitted" && (
        <div className="rounded-2xl border border-black/8 bg-white p-4 text-sm text-text-secondary shadow-sm dark:border-white/10 dark:bg-surface-elevated">
          <span className="font-semibold text-text-primary">Submitted.</span>{" "}
          You can still make changes below until the editing pass starts — just
          save again.
        </div>
      )}

      {/* 1 — TCG Live avatar */}
      <Section
        title="TCG Live avatar"
        hint="Take a screenshot of your avatar in the Pokémon TCG Live app. If the desktop app is available, that's ideal, but a mobile screenshot works perfectly. Don't worry about isolating the subject — that gets taken care of on our end."
      >
        <SubmissionAvatarUploader
          initialUrl={avatarUrl}
          onChange={setAvatarUrl}
        />
      </Section>

      {/* 2 — Favorite Pokémon */}
      <Section
        title="Favorite Pokémon"
        hint="Just the Pokémon — it's rendered as a sprite on your spotlight, independent of any specific card."
      >
        <PokemonNamePicker value={pokemon} onChange={setPokemon} />
      </Section>

      {/* 3 — Favorite cards */}
      <Section
        title="Favorite cards"
        hint={`Up to ${MAX_FAVORITE_CARDS} favorite cards to play, and ${MAX_FAVORITE_CARDS} favorites from your collection. Add a little backstory about why each one stands out to you, or a fun story tied to it.`}
      >
        <CardSearchPicker
          searchEndpoint="/api/spotlight/card-search"
          slots={[
            {
              key: "collection",
              label: "Collection",
              cards: collectionCards,
              setCards: setCollectionCards,
              max: MAX_FAVORITE_CARDS,
            },
            {
              key: "play",
              label: "Play",
              cards: playCards,
              setCards: setPlayCards,
              max: MAX_FAVORITE_CARDS,
            },
          ]}
        />
      </Section>

      {/* 4 — Headline */}
      <Section
        title="Headline"
        hint="Optional. If you have a slogan, something you're known for, a tagline you use at locals, or anything similar — let's hear it."
      >
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={200}
          placeholder="Your tagline"
          className="w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm dark:border-white/10"
        />
      </Section>

      {/* 5 — Introduction */}
      <Section
        title="Introduction"
        hint="Freeform — take the mic. Share about yourself and your Pokémon story, however you see fit. 3–6 sentences is the sweet spot."
      >
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={7}
          placeholder="Your Pokémon story…"
          className="w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm resize-y dark:border-white/10"
        />
      </Section>

      {/* 6 — Interview questions */}
      <Section
        title="Interview questions"
        hint={`Choose ${MIN_ANSWERS}–${MAX_ANSWERS} questions to answer. 2–4 sentences each is the sweet spot.`}
      >
        <p
          className={`text-xs font-semibold ${
            answeredCount >= MIN_ANSWERS ? "text-text-secondary" : "text-accent"
          }`}
        >
          {answeredCount} of {MIN_ANSWERS}–{MAX_ANSWERS} answered
        </p>
        <div className="mt-3 space-y-3">
          {SPOTLIGHT_QUESTIONS.map((question) => {
            const selected = question.id in answers;
            const atLimit =
              !selected && Object.keys(answers).length >= MAX_ANSWERS;
            return (
              <div
                key={question.id}
                className="border-t border-black/8 pt-3 first:border-t-0 first:pt-0 dark:border-white/10"
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={atLimit}
                    onChange={() => toggleQuestion(question.id)}
                    className="mt-0.5 accent-[var(--accent)] disabled:opacity-40"
                  />
                  <span
                    className={`text-sm ${
                      atLimit ? "text-text-muted" : "text-text-primary"
                    }`}
                  >
                    {question.q}
                  </span>
                </label>
                {selected && (
                  <textarea
                    value={answers[question.id]}
                    onChange={(e) =>
                      setAnswers({ ...answers, [question.id]: e.target.value })
                    }
                    rows={4}
                    placeholder="Your answer…"
                    className="mt-2 w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm resize-y dark:border-white/10"
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* 7 — Featured decks */}
      <Section
        title="Featured decks"
        hint={`Up to ${MAX_FEATURED_DECKS} of your saved decks to show on your spotlight.`}
      >
        {deckOptions.length === 0 ? (
          <p className="text-xs text-text-muted">
            You don&rsquo;t have any saved decks yet — save one from the home
            page and it&rsquo;ll show up here.
          </p>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: MAX_FEATURED_DECKS }).map((_, i) => (
              <select
                key={i}
                value={deckIds[i] ?? ""}
                onChange={(e) => {
                  const next = [...deckIds];
                  next[i] = e.target.value;
                  setDeckIds(next);
                }}
                className="w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm dark:border-white/10"
              >
                <option value="">— none —</option>
                {deckOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ))}
          </div>
        )}
      </Section>

      {/* 8 — Card lists (optional) */}
      <Section
        title="Card lists"
        hint="Optional. If you've put a list together for a good reason — a favorite artist, a set you're chasing — flag it and it may get a mention."
      >
        {listOptions.length === 0 ? (
          <p className="text-xs text-text-muted">
            You don&rsquo;t have any card lists yet.
          </p>
        ) : (
          <div className="space-y-2">
            {listOptions.map((list) => (
              <label
                key={list.short_id}
                className="flex items-center gap-2 cursor-pointer text-sm text-text-primary"
              >
                <input
                  type="checkbox"
                  checked={listIds.includes(list.short_id)}
                  onChange={() =>
                    setListIds((prev) =>
                      prev.includes(list.short_id)
                        ? prev.filter((s) => s !== list.short_id)
                        : [...prev, list.short_id],
                    )
                  }
                  className="accent-[var(--accent)]"
                />
                {list.name}
              </label>
            ))}
          </div>
        )}
      </Section>

      {/* Anything else */}
      <Section
        title="Anything else"
        hint="Optional. Anything you'd like passed along that the questions above didn't cover."
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-black/15 bg-bg px-3 py-2 [font-size:16px] sm:text-sm resize-y dark:border-white/10"
        />
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <span className="text-xs text-accent">{error}</span>}
        {savedAt && !error && (
          <span className="text-xs text-text-muted">Saved {savedAt}</span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || submitting}
          className="text-sm font-semibold px-4 py-2 rounded-full border border-black/15 text-text-primary hover:bg-[var(--surface)] disabled:opacity-50 dark:border-white/10"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving || submitting || !canSubmit}
          title={
            canSubmit
              ? undefined
              : `Add an introduction and at least ${MIN_ANSWERS} answers first`
          }
          className="text-sm font-semibold px-4 py-2 rounded-full gradient-brand shadow-sm hover:opacity-95 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm space-y-3 dark:border-white/10 dark:bg-surface-elevated">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}
