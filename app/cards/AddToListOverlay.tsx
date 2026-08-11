"use client";

import { useState } from "react";
import Link from "next/link";
import NewListDialog from "./NewListDialog";
import { useListPicker } from "./useListPicker";

interface Props {
  setId: string;
  number: string;
  onClose: () => void;
  /** Doubles the text size of the overlay's contents — used on the card
   *  detail page, where the overlay sits on a much larger hero image than
   *  the catalog grid tile's small thumbnail. */
  large?: boolean;
}

/**
 * In-card "add to list" overlay — the same black rounded-overlay
 * treatment as InventoryOverlay's "card" display (the variant picker
 * opened from the +/- capsule). Used by both the catalog grid tile
 * (GridTile.tsx) and the card detail page (AddToListButton.tsx) so
 * "add to list" has one consistent overlay language everywhere instead
 * of a floating dropdown positioned outside the card.
 */
export default function AddToListOverlay({ setId, number, onClose, large = false }: Props) {
  const { state, toggle, addCreatedList } = useListPicker(setId, number, true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const captionSize = large ? "text-[20px]" : "text-[10px]";
  const rowSize = large ? "text-[22px]" : "text-[11px]";

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col rounded-xl bg-black/85 backdrop-blur-sm p-2"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className={`text-white ${captionSize} uppercase tracking-wider font-semibold mb-1.5 px-1`}>
        Add to list
      </div>
      <ul className="flex-1 overflow-y-auto flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        {state.loading ? (
          <li className={`text-white/70 ${rowSize} px-1.5 py-1`}>Loading…</li>
        ) : !state.hasUsername ? (
          <li className={`text-white/70 ${rowSize} leading-relaxed px-1.5 py-1`}>
            <Link href="/welcome" className="font-semibold text-white underline">
              Set a username
            </Link>{" "}
            to start creating lists.
          </li>
        ) : (
          <>
            {state.lists.length === 0 && (
              <li className={`text-white/70 ${rowSize} px-1.5 py-1`}>No lists yet.</li>
            )}
            {state.lists.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md bg-white/10">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!l.containsCard}
                    onChange={() => toggle(l)}
                    className="w-3.5 h-3.5 rounded accent-accent shrink-0"
                  />
                  <span className={`${rowSize} font-semibold text-white truncate`}>{l.name}</span>
                </label>
              </li>
            ))}
          </>
        )}
      </ul>

      {state.hasUsername && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDialogOpen(true);
          }}
          className={`mt-1 text-left ${rowSize} font-semibold text-white/90 hover:text-white px-1.5 py-1`}
        >
          + New list
        </button>
      )}

      <div className="mt-1 flex justify-center">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className="h-7 w-7 flex items-center justify-center rounded-full border border-white/60 text-white/80 hover:text-white hover:border-white hover:bg-white/10 transition-colors"
        >
          <span aria-hidden="true" className="leading-none text-sm">×</span>
        </button>
      </div>

      <NewListDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        cardToAdd={{ setId, number }}
        onCreated={addCreatedList}
      />
    </div>
  );
}
