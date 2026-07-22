"use client";

// NOTE: Price-alert sign-up UI is temporarily disabled.
// The infrastructure (API route at /api/alerts, price_alerts Supabase table,
// RLS policies) is still in place and working. The UI below the price row
// is commented out and will be restored when we build out the user profile
// / "my stuff" surface. To re-enable:
//   1. Uncomment the imports, state, useEffect, and handleAlertSubmit below.
//   2. Change the outer element back from <div> to <details className="...group">
//      and restore the <summary> + chevron + expandable content block.

// import { useState, useEffect } from "react";
// import Link from "next/link";
// import { createClient } from "@/lib/supabase/client";

interface Props {
  deckPrice: number;
  deckList?: string; // retained for when the alert form comes back
}

/**
 * Estimated deck price card.
 *
 * Currently a static card showing just the price. The alert sign-up flow
 * is temporarily hidden (see top-of-file note). The data layer is intact,
 * so turning this back on is a UI-only change.
 */
export default function DeckPriceModule({ deckPrice }: Props) {
  const cardClass = "rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-5";
  // ── Alert sign-up state (disabled) ────────────────────────────────
  // const [alertThreshold, setAlertThreshold] = useState("");
  // const [alertStatus, setAlertStatus] = useState<
  //   "idle" | "loading" | "success" | "error"
  // >("idle");
  // const [signedIn, setSignedIn] = useState<boolean | null>(null);
  //
  // useEffect(() => {
  //   const supabase = createClient();
  //
  //   supabase.auth.getUser().then(({ data: { user } }) => {
  //     setSignedIn(!!user);
  //   });
  //
  //   const {
  //     data: { subscription },
  //   } = supabase.auth.onAuthStateChange((_event, session) => {
  //     setSignedIn(!!session?.user);
  //   });
  //
  //   return () => subscription.unsubscribe();
  // }, []);
  //
  // async function handleAlertSubmit() {
  //   if (!alertThreshold || !deckList) return;
  //   setAlertStatus("loading");
  //   try {
  //     const res = await fetch("/api/alerts", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         deckList,
  //         threshold: parseFloat(alertThreshold),
  //         deckPrice,
  //       }),
  //     });
  //     if (res.ok) {
  //       setAlertStatus("success");
  //     } else {
  //       setAlertStatus("error");
  //     }
  //   } catch {
  //     setAlertStatus("error");
  //   }
  // }

  if (deckPrice <= 0) return null;

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Estimated Deck Price</h2>
        <span className="text-lg font-bold text-text-primary">
          ${deckPrice.toFixed(2)}
        </span>
      </div>

      {/*
        ── Alert sign-up UI (disabled) ──────────────────────────────
        Restore this block and wrap the outer element back in <details>
        when re-enabling. The form posts to /api/alerts, which writes to
        public.price_alerts — both still live and working server-side.

        <div className="mt-4 border-t border-border pt-4">
          {signedIn === null ? (
            <div className="h-16" />
          ) : signedIn ? (
            alertStatus === "success" ? (
              <p className="text-sm text-green-700 font-medium">&#10003; We&apos;ll let you know!</p>
            ) : (
              <>
                <p className="text-xs text-text-muted mb-3">Alert me when this deck drops below</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={alertThreshold || Math.round(deckPrice * 0.85)}
                      onChange={(e) => setAlertThreshold(e.target.value)}
                      onFocus={() => { if (!alertThreshold) setAlertThreshold(String(Math.round(deckPrice * 0.85))); }}
                      className="w-full sm:w-28 rounded-lg border border-border bg-bg pl-7 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 [font-size:16px] sm:text-sm"
                    />
                  </div>
                  <button
                    onClick={handleAlertSubmit}
                    disabled={alertStatus === "loading" || !deckList}
                    className="flex-shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-accent-light disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {alertStatus === "loading" ? "Saving…" : "Notify Me"}
                  </button>
                </div>
                {alertStatus === "error" && (
                  <p className="text-xs text-accent mt-2">Something went wrong, try again.</p>
                )}
              </>
            )
          ) : (
            <div className="text-center">
              <p className="text-xs text-text-muted mb-3">
                Get notified when this deck drops below your target price.
              </p>
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-accent-light"
              >
                Sign in to receive alerts
              </Link>
            </div>
          )}
        </div>
      */}
    </div>
  );
}
