"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SpotlightBannerItem,
  SpotlightBannerItemKey,
} from "../types";

interface Props {
  spotlightId: string;
  itemKey: SpotlightBannerItemKey;
  /** Initial {x, y, scale} for this item. Subsequent server updates
   *  reflect through `key={...}` remounts from the parent if needed. */
  initial: SpotlightBannerItem;
  /** Item width as a fraction of the banner width at scale = 1.0.
   *  Each item type has its own visual footprint. */
  baseWidthPct: number;
  /** The actual rendered media — the parent supplies an <img>, sprite,
   *  or card art element. The item wrapper handles geometry only. */
  children: React.ReactNode;
  /** When true, the item is draggable + resizable. Persists new values
   *  to /api/admin/spotlight/[id] under banner_layout.<itemKey>. */
  editable: boolean;
}

const SAVE_DEBOUNCE_MS = 500;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3.0;
const WHEEL_STEP = 0.04;

/**
 * One repositionable + resizable item inside the spotlight banner. All
 * four banner elements (collection card, Pokémon sprite, user image,
 * format card) use this same wrapper — only `children` and
 * `baseWidthPct` change between them, so the gesture model is identical
 * across the whole banner.
 *
 * Persists position + scale together via one debounced PATCH so a
 * combined move + resize gesture costs a single network round trip.
 */
export default function SpotlightBannerItem({
  spotlightId,
  itemKey,
  initial,
  baseWidthPct,
  children,
  editable,
}: Props) {
  const [state, setState] = useState<SpotlightBannerItem>(initial);
  const [mode, setMode] = useState<"idle" | "move" | "resize">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<SpotlightBannerItem>(initial);

  // Sync local state when the server-side initial changes (e.g. after a
  // Reset). Cheap deep-equality via JSON.stringify since the object is
  // tiny and only contains numbers.
  useEffect(() => {
    if (JSON.stringify(initial) !== JSON.stringify(state)) {
      setState(initial);
      latest.current = initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const schedulePersist = useCallback(() => {
    if (!editable) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/admin/spotlight/${spotlightId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            banner_layout: { [itemKey]: latest.current },
          }),
        });
      } catch {
        // No retry surface — user can repeat the gesture.
      }
    }, SAVE_DEBOUNCE_MS);
  }, [editable, itemKey, spotlightId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function applyPos(x: number, y: number) {
    const next = {
      ...latest.current,
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    };
    setState(next);
    latest.current = next;
    schedulePersist();
  }
  function applyScale(scale: number) {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const next = { ...latest.current, scale: clamped };
    setState(next);
    latest.current = next;
    schedulePersist();
  }

  // ── Move drag ─────────────────────────────────────────────────

  const movePointerMove = useCallback(
    (e: PointerEvent) => {
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      applyPos(
        ((e.clientX - rect.left) / rect.width) * 100,
        ((e.clientY - rect.top) / rect.height) * 100,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation(); // siblings shouldn't also start dragging
    setMode("move");
    document.addEventListener("pointermove", movePointerMove);
    const stop = () => {
      setMode("idle");
      document.removeEventListener("pointermove", movePointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
  }

  // ── Resize handle (bottom-right corner) ───────────────────────

  const resizeStart = useRef<{
    centerX: number;
    centerY: number;
    startDist: number;
    startScale: number;
  } | null>(null);

  const resizePointerMove = useCallback(
    (e: PointerEvent) => {
      const s = resizeStart.current;
      if (!s) return;
      const dist = Math.hypot(e.clientX - s.centerX, e.clientY - s.centerY);
      const ratio = dist / Math.max(s.startDist, 1);
      applyScale(s.startScale * ratio);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function onResizePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    resizeStart.current = {
      centerX,
      centerY,
      startDist: Math.hypot(e.clientX - centerX, e.clientY - centerY),
      startScale: state.scale,
    };
    setMode("resize");
    document.addEventListener("pointermove", resizePointerMove);
    const stop = () => {
      setMode("idle");
      resizeStart.current = null;
      document.removeEventListener("pointermove", resizePointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
  }

  // ── Scroll wheel → scale ──────────────────────────────────────

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    applyScale(state.scale + (e.deltaY < 0 ? 1 : -1) * WHEEL_STEP);
  }

  const widthPct = baseWidthPct * state.scale;
  const isMoving = mode === "move";
  const isResizing = mode === "resize";

  return (
    <div
      ref={containerRef}
      onPointerDown={onContainerPointerDown}
      onWheel={onWheel}
      className={`absolute select-none ${
        editable
          ? `${isMoving ? "cursor-grabbing" : "cursor-grab"} touch-none`
          : "pointer-events-none"
      }`}
      style={{
        left: `${state.x}%`,
        top: `${state.y}%`,
        width: `${widthPct}%`,
        transform: "translate(-50%, -50%)",
        outline:
          editable && (isMoving || isResizing)
            ? "2px dashed rgba(255,255,255,0.7)"
            : "none",
        outlineOffset: 4,
      }}
    >
      <div className="w-full h-auto drop-shadow-lg">{children}</div>
      {editable && (
        <button
          type="button"
          aria-label="Resize"
          onPointerDown={onResizePointerDown}
          onClick={(e) => e.stopPropagation()}
          className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-white border-2 border-black/40 shadow flex items-center justify-center cursor-nwse-resize dark:bg-surface-elevated"
        >
          <svg
            viewBox="0 0 16 16"
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
          >
            <path d="M3 13 L13 3" />
            <path d="M7 13 L13 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
