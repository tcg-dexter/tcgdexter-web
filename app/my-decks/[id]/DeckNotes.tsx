"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  savedDeckId: string;
  initialNotes: string;
}

/**
 * Notes editor for a saved deck. Read-only until the Edit capsule is
 * tapped, which focuses the textarea and swaps the capsule for a
 * gradient Save button (plus a Cancel button to its left).
 */
export default function DeckNotes({ savedDeckId, initialNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [autoResize, notes, draft]);

  function startEdit() {
    setDraft(notes);
    setEditing(true);
    // Wait for the textarea to become editable before focusing — the
    // [font-size:16px] class keeps iOS Safari from zooming on focus.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function handleCancel() {
    setDraft(notes);
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft }),
      });
      if (res.ok) {
        setNotes(draft);
        setEditing(false);
      }
    } catch {
      // Silent — user can retry by editing again
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Notes</h2>
        <div className="flex items-center gap-2">
          {editing && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="text-xs font-semibold text-text-primary hover:text-text-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {editing ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center rounded-full gradient-brand px-3 py-1.5 text-xs font-semibold shadow-brand hover:shadow-brand-lg transition disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center rounded-full bg-black border border-transparent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-80 transition"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={editing ? draft : notes}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={!editing}
        placeholder="Strategy notes, matchup observations, card swap ideas..."
        rows={1}
        className={`block w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none resize-none overflow-hidden [font-size:16px] sm:text-sm ${
          editing ? "" : "cursor-default"
        }`}
      />
    </div>
  );
}
