"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * "Danger Zone" trigger + confirmation modal for permanently deleting the
 * signed-in user's account. Requires typing "DELETE" to enable the confirm
 * button — more friction than the deck-delete modal this is adapted from,
 * since this action is far more consequential.
 */
export default function DeleteAccountButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setConfirmText("");
    setError(null);
    setConfirming(true);
  }

  function closeModal() {
    if (deleting) return;
    setConfirming(false);
  }

  async function performDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: confirmText }),
      });
      const data = await res.json();
      if (res.ok) {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.refresh();
        router.push("/");
      } else {
        setError(data.error ?? "Failed to delete account.");
        setDeleting(false);
      }
    } catch {
      setError("Network error.");
      setDeleting(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">
        Delete account
      </p>
      <p className="mt-0.5 text-sm text-text-secondary">
        Permanently delete your account and all associated data.
      </p>
      <button
        onClick={openModal}
        className="mt-2 text-xs font-semibold text-accent hover:text-accent-light"
      >
        Delete my account
      </button>

      {confirming &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="delete-account-title"
                className="text-base font-semibold text-text-primary"
              >
                Delete your account?
              </h2>
              <p className="mt-2 text-sm text-text-secondary">
                This permanently removes your profile, saved decks, match
                history, card collection, achievements, price alerts, and
                shared match links. This cannot be undone.
              </p>
              <label className="mt-4 block">
                <span className="text-xs font-semibold text-text-secondary">
                  Type <span className="font-mono text-text-primary">DELETE</span> to confirm
                </span>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={deleting}
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 disabled:opacity-50 [font-size:16px] sm:text-sm"
                />
              </label>
              {error && <p className="mt-2 text-xs text-accent">{error}</p>}
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={deleting}
                  className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition disabled:opacity-50 touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={performDelete}
                  disabled={deleting || confirmText !== "DELETE"}
                  className="inline-flex items-center justify-center rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
                >
                  {deleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
