"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  savedDeckId: string;
  initialNotes: string;
}

const SAVE_DEBOUNCE_MS = 2000;

/**
 * Always-editable notes editor for a saved deck. There's no edit/save
 * toggle — the textarea is focusable at all times and persists changes
 * automatically 2 seconds after the user stops typing (debounced). A
 * pending change also flushes on blur so nothing is lost.
 *
 * The editor blurs itself when the user taps/clicks outside it, or when
 * it scrolls out of view. The [font-size:16px] class keeps iOS Safari
 * from zooming the viewport when the textarea gains focus.
 */
export default function DeckNotes({ savedDeckId, initialNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedValue = useRef(initialNotes);
  const savedStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [autoResize, notes]);

  const save = useCallback(
    async (value: string) => {
      if (value === savedValue.current) return;
      if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
      setStatus("saving");
      try {
        const res = await fetch(`/api/saved-decks/${savedDeckId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: value }),
        });
        if (res.ok) {
          savedValue.current = value;
          setStatus("saved");
          savedStatusTimer.current = setTimeout(() => setStatus("idle"), 2000);
        } else {
          setStatus("idle");
        }
      } catch {
        setStatus("idle");
      }
    },
    [savedDeckId],
  );

  function handleChange(value: string) {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Nothing to persist if we're back to the last-saved value.
    if (value === savedValue.current) {
      setStatus("idle");
      return;
    }
    saveTimer.current = setTimeout(() => save(value), SAVE_DEBOUNCE_MS);
  }

  // Flush a pending change immediately on blur (outside tap, scroll-off,
  // or manual unfocus) so notes aren't lost before the debounce fires.
  function flushPending() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (notes !== savedValue.current) save(notes);
  }

  // Blur on outside pointer-down.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        textareaRef.current?.blur();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Blur when the editor scrolls out of view.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) el.blur();
      },
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Clear timers on unmount.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="rounded-xl bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">Notes</h2>
        {status !== "idle" && (
          <span className="text-xs font-medium text-text-muted">
            {status === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={flushPending}
        placeholder="Write something…"
        rows={1}
        className="block w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none resize-none overflow-hidden [font-size:16px] sm:text-sm"
      />
    </div>
  );
}
