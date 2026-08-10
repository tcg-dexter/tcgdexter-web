"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GradientButton from "@/app/components/ui/GradientButton";
import { useInventory } from "./InventoryContext";
import ListPreviewCard from "./ListPreviewCard";
import NewListDialog from "./NewListDialog";
import type { ListSummary } from "@/lib/lists";

interface ListsState {
  loading: boolean;
  lists: ListSummary[];
  hasUsername: boolean;
}

/**
 * Lists overview panel — mirrors DataView.tsx structurally (signed-out CTA,
 * loading state, empty CTA), swapped for named card lists instead of set
 * completion. Fetched client-side from GET /api/lists, same lazy pattern
 * DataView uses for /api/collection/data-view.
 */
export default function ListsView() {
  const { signedIn } = useInventory();
  const [state, setState] = useState<ListsState>({
    loading: false,
    lists: [],
    hasUsername: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (signedIn !== true) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/lists")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load lists"))))
      .then((data: { lists: ListSummary[]; hasUsername: boolean }) => {
        if (cancelled) return;
        setState({ loading: false, lists: data.lists, hasUsername: data.hasUsername });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, lists: [], hasUsername: true });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (signedIn === null) {
    return <p className="text-sm text-text-secondary py-4">Loading…</p>;
  }

  if (signedIn === false) {
    return (
      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
        <p className="text-sm text-text-secondary">
          <Link href="/sign-in" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{" "}
          to create and save named lists of cards.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold tracking-tight text-text-primary">Your Lists</h3>
        {state.hasUsername && (
          <GradientButton onClick={() => setDialogOpen(true)}>New List</GradientButton>
        )}
      </div>

      {!state.loading && !state.hasUsername && (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
          <p className="text-sm text-text-secondary">
            <Link href="/welcome" className="font-semibold text-accent hover:underline">
              Set a username
            </Link>{" "}
            on your profile to start creating lists.
          </p>
        </div>
      )}

      {state.loading ? (
        <p className="text-sm text-text-secondary py-4">Loading your lists…</p>
      ) : state.hasUsername && state.lists.length === 0 ? (
        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
          <p className="text-sm text-text-secondary">
            No lists yet. Start one to track cards you want, trade, or need for your next deck.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {state.lists.map((l) => (
            <ListPreviewCard key={l.id} list={l} />
          ))}
        </div>
      )}

      <NewListDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(created) => {
          setState((s) => ({
            ...s,
            lists: [
              {
                id: created.id,
                shortId: created.shortId,
                name: created.name,
                isPublic: created.isPublic,
                itemCount: 0,
                href: created.href,
                previewCards: [],
              },
              ...s.lists,
            ],
          }));
        }}
      />
    </div>
  );
}
