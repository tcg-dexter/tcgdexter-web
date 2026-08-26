"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AddSelectionToListDialog from "@/app/cards/AddSelectionToListDialog";

interface Props {
  /** Every distinct printing in the deck, already de-duplicated by caller. */
  cards: Array<{ setId: string; number: string }>;
}

/**
 * "Add Deck to List" — the deck-profile counterpart to the card detail
 * page's AddToListButton, sharing its chrome so the two read as one control.
 *
 * Reuses AddSelectionToListDialog rather than AddToListOverlay's per-list
 * toggle: a whole deck is inherently a multi-card selection, and "is this
 * already in the list" stops being a single boolean the moment there's more
 * than one card — which is exactly the case that dialog was built for.
 *
 * Auth is resolved in the browser instead of threaded down as a prop.
 * DeckProfileView has no "use client" of its own but is imported by
 * HomeClient (which does), so on the home page it renders inside a client
 * tree and cannot reach the server Supabase client; every other caller would
 * otherwise have to grow an `isAuthenticated` prop it doesn't need.
 */
export default function AddDeckToListButton({ cards }: Props) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "Added to list" label reverts on a timer; clear it on unmount so it
  // can't setState on a dead component (the deck profile unmounts out from
  // under this when a fresh analysis replaces it on the home page).
  useEffect(
    () => () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const supabase = createClient();

    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setSignedIn(!!user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  async function handleClick() {
    let authed = signedIn;
    if (authed === null) {
      // The effect's getUser() hasn't landed yet. Resolve on demand rather
      // than disabling the button until it does — the button paints on the
      // server, and a CTA that's inert on first tap reads as broken.
      setChecking(true);
      try {
        const { data } = await createClient().auth.getUser();
        authed = !!data.user;
        setSignedIn(authed);
      } catch {
        authed = false;
      } finally {
        setChecking(false);
      }
    }
    if (!authed) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setOpen(true);
  }

  // Nothing resolvable to add (e.g. a deck list whose lines don't map to
  // printings in the Standard card DB) — no point showing a dead control.
  if (cards.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={checking}
        aria-label="Add every card in this deck to a list"
        className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {added ? (
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M4 10.5l4 4 8-9" />
            </svg>
            Added to list
          </>
        ) : (
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="w-4 h-4"
            >
              <path d="M10 4v12M4 10h12" />
            </svg>
            Add Deck to List
          </>
        )}
      </button>

      <AddSelectionToListDialog
        open={open}
        onClose={() => setOpen(false)}
        cards={cards}
        // The catalog's callers use onAdded to leave Select mode; there's no
        // selection to unwind here and list membership isn't rendered on this
        // page, so a transient label swap (the CopyDeckListButton pattern) is
        // the whole acknowledgement.
        onAdded={() => {
          setAdded(true);
          if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
          addedTimerRef.current = setTimeout(() => {
            setAdded(false);
            addedTimerRef.current = null;
          }, 2000);
        }}
      />
    </>
  );
}
