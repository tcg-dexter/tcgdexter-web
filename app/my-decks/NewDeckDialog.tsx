"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import GradientButton from "@/app/components/ui/GradientButton";
import {
  primaryPokemonCard,
  primaryCardImageUrl,
} from "@/lib/primaryCardImage";

interface AnalysisCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful save so the caller can refresh the collection. */
  onCreated: () => void;
}

/**
 * Create-a-deck modal launched from the Deck Collection "New Deck" button.
 * Step 1 mirrors the home page's deck-list input (gradient-glow glass card).
 * Step 2 repurposes the save-deck popup's name + visibility inputs; the cover
 * is fixed to the auto-pick (highest-stage Pokémon), so the save is one tap.
 * On success we dismiss and let the caller reload the collection, which then
 * renders the new deck's preview card.
 */
export default function NewDeckDialog({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<"list" | "save">("list");
  const [deckList, setDeckList] = useState("");
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean slate whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setStep("list");
      setDeckList("");
      setAnalysis(null);
      setName("");
      setIsPublic(true);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // Escape closes (unless mid-request).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  const cards: AnalysisCard[] =
    (analysis as { cards?: AnalysisCard[] } | null)?.cards ?? [];
  const autoCoverUrl = primaryCardImageUrl(cards);

  async function handleContinue() {
    const trimmed = deckList.trim();
    if (!trimmed) {
      setError("Paste your deck list first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "We couldn't read that deck list.");
        return;
      }
      const analyzed = data as {
        cards?: AnalysisCard[];
        metaMatch?: { archetypeName?: string | null };
      };
      setAnalysis(analyzed);
      setName(
        analyzed.metaMatch?.archetypeName ??
          primaryPokemonCard(analyzed.cards ?? [])?.card.name ??
          "My Deck",
      );
      setStep("save");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give your deck a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/saved-decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckList: deckList.trim(),
          name: trimmedName,
          publish: isPublic,
          // null → the server auto-derives the cover (highest-stage Pokémon),
          // matching the auto-pick preview shown above.
          coverUrl: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save deck.");
        return;
      }
      onClose();
      onCreated();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-deck-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient-glow glass card — same treatment as the home deck input. */}
        <div className="relative group">
          <div className="absolute -inset-px rounded-2xl bg-gradient-brand opacity-40 group-focus-within:opacity-70 blur-xl transition-opacity" />
          <div className="relative rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-brand-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2
                id="new-deck-title"
                className="text-lg font-semibold tracking-tight"
              >
                <span className="bg-gradient-brand bg-clip-text text-transparent">
                  {step === "list" ? "New deck" : "Save to collection"}
                </span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                className="rounded-full p-1.5 text-text-muted hover:bg-black/5 hover:text-text-primary transition disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {step === "list" ? (
              /* Step 1 — deck list input */
              <div className="px-5 pb-5">
                <label
                  htmlFor="new-deck-list"
                  className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                >
                  Deck list
                </label>
                <textarea
                  id="new-deck-list"
                  value={deckList}
                  onChange={(e) => setDeckList(e.target.value)}
                  disabled={busy}
                  placeholder={"Pokémon: 13\n3 N's Zoroark ex JTG 175\n2 N's Reshiram ASC 154\n..."}
                  className="w-full h-44 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-none disabled:opacity-50 [font-size:16px] sm:text-xs"
                  spellCheck={false}
                />
                {error && (
                  <p className="mt-2 text-xs text-accent" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-end gap-3">
                  {deckList.length > 0 && !busy && (
                    <button
                      type="button"
                      onClick={() => setDeckList("")}
                      className="text-xs text-text-muted hover:text-text-primary transition"
                    >
                      Clear
                    </button>
                  )}
                  <GradientButton onClick={handleContinue} disabled={busy}>
                    {busy ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Reading…
                      </>
                    ) : (
                      "Continue"
                    )}
                  </GradientButton>
                </div>
              </div>
            ) : (
              /* Step 2 — name + visibility, auto cover */
              <div className="px-5 pb-5">
                {/* Name */}
                <label
                  htmlFor="new-deck-name"
                  className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                >
                  Deck name
                </label>
                <input
                  id="new-deck-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  disabled={busy}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
                />

                {/* Visibility */}
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Visibility
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPublic(true)}
                    disabled={busy}
                    aria-pressed={isPublic}
                    className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition disabled:opacity-50 ${
                      isPublic
                        ? "border-accent bg-accent/5 text-accent"
                        : "border-black/10 bg-white dark:bg-surface-2 text-text-secondary hover:bg-black/[0.02]"
                    }`}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPublic(false)}
                    disabled={busy}
                    aria-pressed={!isPublic}
                    className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition disabled:opacity-50 ${
                      !isPublic
                        ? "border-accent bg-accent/5 text-accent"
                        : "border-black/10 bg-white dark:bg-surface-2 text-text-secondary hover:bg-black/[0.02]"
                    }`}
                  >
                    Private
                  </button>
                </div>
                {isPublic && (
                  <p className="mt-1.5 text-[11px] text-text-secondary">
                    Visible on your public profile and in recent matches.
                  </p>
                )}

                {/* Auto cover preview */}
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                  Cover image
                </p>
                <div className="flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-surface-2 p-2.5">
                  <div
                    className="shrink-0 rounded-md overflow-hidden border border-black/[0.07] bg-[var(--surface)] flex items-center justify-center"
                    style={{ width: 44, height: 60 }}
                  >
                    {autoCoverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={autoCoverUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[8px] text-text-muted leading-tight px-1 text-center">
                        Auto
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">
                      Auto-picked
                    </p>
                    <p className="text-xs text-text-secondary">
                      Highest-stage Pokémon. Change it later from the deck page.
                    </p>
                  </div>
                </div>

                {error && (
                  <p className="mt-3 text-xs text-accent" role="alert">
                    {error}
                  </p>
                )}

                {/* Footer */}
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("list");
                      setError(null);
                    }}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy || name.trim().length === 0}
                    className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50 touch-manipulation"
                  >
                    {busy ? "Saving…" : "Save to collection"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
