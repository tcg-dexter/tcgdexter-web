"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { stashDeckList } from "@/lib/home-restore";
import EditDeckDialog from "@/app/components/EditDeckDialog";
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
  deckList: string;
  analysis: unknown;
  className?: string;
  source?: "meta";
  metaArchetypeId?: string | null;
}

export default function SaveDeckButton({
  deckList,
  analysis,
  className,
  source,
  metaArchetypeId,
}: Props) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(!!user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setSignedIn(!!session?.user),
    );
    return () => subscription.unsubscribe();
  }, []);

  const analysisObj = analysis as {
    cards?: AnalysisCard[];
    metaMatch?: { archetypeName?: string | null };
  } | null;
  const cards: AnalysisCard[] = analysisObj?.cards ?? [];
  const defaultName =
    analysisObj?.metaMatch?.archetypeName ??
    primaryPokemonCard(cards)?.card.name ??
    "My Deck";
  const defaultCoverUrl = primaryCardImageUrl(cards);

  function handleClick() {
    if (signedIn === null) return;
    if (!signedIn) {
      setSignInPrompt(true);
      return;
    }
    setDialogOpen(true);
  }

  async function handleSave({
    name,
    coverUrl,
    isPublic,
  }: {
    name: string;
    coverUrl: string | null;
    deckList: string;
    isPublic?: boolean;
  }) {
    const analysisData = analysis as Record<string, unknown> | null;
    let resolvedAnalysis = analysis;
    if (!analysisData || !("deckSize" in analysisData)) {
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList }),
      });
      if (analyzeRes.ok) resolvedAnalysis = await analyzeRes.json();
    }

    const res = await fetch("/api/saved-decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckList,
        analysis: resolvedAnalysis,
        name,
        coverUrl: coverUrl ?? null,
        publish: isPublic === true,
        source,
        metaArchetypeId,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to save deck.");
    }

    setSavedDeckId(data.id as string);
  }

  const baseClasses =
    className ??
    "inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-black/85 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <>
      {savedDeckId ? (
        <button
          onClick={() => router.push(`/my-decks/${savedDeckId}`)}
          className={baseClasses}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          View Deck
        </button>
      ) : (
        <button
          onClick={handleClick}
          disabled={signedIn === null}
          className={baseClasses}
          aria-label="Save deck to My Decks"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
          Save Deck
        </button>
      )}

      <EditDeckDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        mode="save"
        initialName={defaultName}
        initialIsPublic={true}
        cards={cards}
        currentCoverUrl={null}
        defaultCoverUrl={defaultCoverUrl}
        initialDeckList={deckList}
        onSave={handleSave}
      />

      {/* Sign-in prompt for signed-out users */}
      {signInPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setSignInPrompt(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">
                Sign in to save decks
              </h2>
              <button
                onClick={() => setSignInPrompt(false)}
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors -mt-1 -mr-1 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-text-secondary mb-5 leading-relaxed">
              Save this deck to your personal collection and access it
              anytime from the My Decks page. Sign in with a magic link —
              no password required.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  stashDeckList(deckList);
                  router.push(`/sign-in?next=${encodeURIComponent("/")}`);
                }}
                className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-light"
              >
                Sign in
              </button>
              <button
                onClick={() => setSignInPrompt(false)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
