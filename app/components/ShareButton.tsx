"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { stashDeckList } from "@/lib/home-restore";

interface Props {
  deckList: string;
  analysis: unknown;
  /**
   * When provided, this URL is used directly for system-share / clipboard
   * fallback instead of POSTing to any API. Set on public deck pages where
   * the canonical /u/[username]/[deckId] URL is already known by the
   * server-rendered parent.
   */
  shareUrl?: string;
  /**
   * Treat Share as Save+Publish — the home-page "compose a fresh deck"
   * flow. POSTs to /api/saved-decks with publish=true, then routes the
   * user to their new /u/[username]/[id] post. When the user is signed
   * out, prompts sign-in and stashes the deck for restore.
   */
  publishMode?: boolean;
  className?: string;
  /**
   * Origin of the share. Forwarded to /api/deck-share so the server can
   * fire a Product-specific event ("meta.deck.shared") in addition to the
   * umbrella deck.shared counter.
   */
  source?: "meta";
  metaArchetypeId?: string | null;
}

export default function ShareButton({
  deckList,
  analysis,
  shareUrl: presetUrl,
  publishMode,
  className,
  source,
  metaArchetypeId,
}: Props) {
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);

  useEffect(() => {
    // Auth state is needed for both publish and default share flows now
    // that anonymous sharing has been removed. Skip only for presetUrl,
    // which bypasses the API entirely.
    if (presetUrl) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(!!user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });
    return () => subscription.unsubscribe();
  }, [presetUrl]);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setShareError(null);
    setShareUrl(null);
    try {
      let url: string;
      if (presetUrl) {
        // Public deck page: skip the API; the server already knows the
        // canonical URL.
        url = presetUrl;
      } else if (publishMode) {
        // Home-page "fresh" flow: signed-in user presses Share → publish
        // the deck and route to its trainer URL.
        if (signedIn === null) {
          setSharing(false);
          return; // still resolving auth state
        }
        if (!signedIn) {
          setSignInPrompt(true);
          setSharing(false);
          return;
        }
        const res = await fetch("/api/saved-decks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckList, analysis, publish: true }),
        });
        const data = await res.json();
        if (!res.ok) {
          setShareError(data.error ?? "Failed to publish deck.");
          return;
        }
        if (!data.publicUrl) {
          // Profile wasn't ready (no username, or not public) — server
          // returned 422 with a hint above. This branch is a safety net.
          setShareError("Couldn't publish — make your profile public first.");
          return;
        }
        router.push(data.publicUrl);
        return;
      } else {
        if (signedIn === null) {
          setSharing(false);
          return; // still resolving auth state
        }
        if (!signedIn) {
          setSignInPrompt(true);
          setSharing(false);
          return;
        }
        const res = await fetch("/api/deck-share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckList, analysis, source, metaArchetypeId }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          setShareError(data.error ?? "Failed to create share link.");
          return;
        }
        url = data.url;
      }

      // Try the system share sheet first.
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "TCG Dexter — Deck Profile",
            text: "Check out this Pokémon TCG deck profile:",
            url,
          });
          return; // Sheet handled it — no modal needed.
        } catch (err) {
          // AbortError = user dismissed the sheet — no fallback needed.
          if (err instanceof Error && err.name === "AbortError") return;
          // Any other error (e.g. gesture chain broken on Safari) → fall through to modal.
        }
      }

      // Fallback: show copy modal.
      setShareUrl(url);
    } catch {
      setShareError("Network error — please try again.");
    } finally {
      setSharing(false);
    }
  }

  async function handleCopyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch {
      setShareError("Couldn't copy automatically — select the URL above and copy manually.");
    }
  }

  function closeShareModal() {
    setShareUrl(null);
    setShareError(null);
  }

  const baseClasses =
    className ??
    "flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <>
      <button onClick={handleShare} disabled={sharing} className={baseClasses}>
        {sharing ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Sharing…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
            </svg>
            Share
          </>
        )}
      </button>

      {/* ── Share Modal ─────────────────────────────────────── */}
      {shareUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={closeShareModal}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Share this deck</h2>
              <button
                onClick={closeShareModal}
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors -mt-1 -mr-1 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-text-muted mb-3">
              Anyone with this link can view your deck profile.
            </p>

            <input
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-black/8 bg-white/60 dark:bg-surface-2 px-3 py-2 text-xs font-mono text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-xs"
            />

            {shareError && (
              <p className="mt-2 text-xs text-accent">{shareError}</p>
            )}

            <div className="mt-4">
              <button
                onClick={handleCopyShareUrl}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-black/8 bg-white/60 dark:bg-surface-2 px-4 py-2.5 text-sm font-semibold text-text-primary transition-all hover:bg-white dark:hover:bg-surface-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Copy-confirmation toast ─────────────────────────── */}
      {shareToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg animate-fade-toast">
          Link copied!
        </div>
      )}

      {/* ── Sign-in prompt (publishMode + signed-out) ──────── */}
      {signInPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setSignInPrompt(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">
                Sign in to share decks
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
              {publishMode
                ? "Sharing publishes your deck to your trainer profile so anyone can like and discover it. Sign in with a magic link — no password required."
                : "Sharing creates a short link anyone can open to view this deck profile. Sign in with a magic link — no password required."}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  stashDeckList(deckList, "share");
                  const next =
                    publishMode || typeof window === "undefined"
                      ? "/"
                      : window.location.pathname + window.location.search;
                  router.push(`/sign-in?next=${encodeURIComponent(next)}`);
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
