"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { stashDeckList } from "@/lib/home-restore";

interface Props {
  deckList: string;
  analysis: unknown;
  /**
   * Optional className override for the base button styling — callers can
   * pass this to integrate with different layouts (e.g. primary/accent
   * color vs. secondary outline).
   */
  className?: string;
  /**
   * Origin of the save. Forwarded to /api/saved-decks so the server can
   * fire a Product-specific event ("meta.deck.saved") in addition to the
   * umbrella deck.saved counter.
   */
  source?: "meta";
  metaArchetypeId?: string | null;
}

type SaveStatus = "idle" | "loading" | "saved" | "error";

/**
 * Save Deck button.
 *
 * Behavior:
 * - Signed-in user clicks → POST /api/saved-decks → "Saved" toast with link
 *   to /my-decks.
 * - Signed-out user clicks → opens a modal explaining they need to sign in,
 *   with a Sign in button that routes to /sign-in.
 *
 * Subscribes to Supabase auth state so the button behavior updates in real
 * time if the user signs in/out from another tab or component.
 */
export default function SaveDeckButton({
  deckList,
  analysis,
  className,
  source,
  metaArchetypeId,
}: Props) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setSignedIn(!!user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSave() {
    if (signedIn === null) return; // still loading auth state
    if (!signedIn) {
      setSignInPrompt(true);
      return;
    }

    setStatus("loading");
    setErrorMsg(null);
    try {
      // If no full analysis is provided (e.g. saving from a meta deck page),
      // run the deck list through the analyzer first so the saved profile is complete.
      const analysisObj = analysis as Record<string, unknown> | null;
      let resolvedAnalysis = analysis;
      if (!analysisObj || !("deckSize" in analysisObj)) {
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckList }),
        });
        if (analyzeRes.ok) {
          resolvedAnalysis = await analyzeRes.json();
        }
      }

      const res = await fetch("/api/saved-decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckList,
          analysis: resolvedAnalysis,
          source,
          metaArchetypeId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 5000);
      } else {
        setStatus("error");
        setErrorMsg(data.error ?? "Failed to save deck.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Network error — please try again.");
    }
  }

  const baseClasses =
    className ??
    "inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-black/85 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <>
      <button
        onClick={handleSave}
        disabled={status === "loading" || signedIn === null}
        className={baseClasses}
        aria-label="Save deck to My Decks"
      >
        {status === "loading" ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving…
          </>
        ) : status === "saved" ? (
          <>
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Saved
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
            Save Deck
          </>
        )}
      </button>

      {/* ── Error toast ────────────────────────────────────── */}
      {status === "error" && errorMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          {errorMsg}
        </div>
      )}

      {/* ── Sign-in prompt modal (for signed-out users) ────── */}
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
                  // Persist the user's deck across the sign-in redirect so
                  // they don't lose their paste; the home page checks
                  // sessionStorage on mount and restores the textarea
                  // regardless of which auth path the user took (OAuth,
                  // magic link, etc.).
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
