"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpotlightAvatarPosition } from "../types";

interface Props {
  spotlightId: string;
  url: string;
  initialPosition: SpotlightAvatarPosition;
  initialScale: number;
  /** When true, the image can be dragged + resized. PATCHes new values
   *  to the API after the gesture settles. */
  editable: boolean;
}

const SAVE_DEBOUNCE_MS = 600;
/** Base image width as a fraction of banner width (multiplied by scale). */
const BASE_WIDTH_PCT = 32;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3.0;
/** Default value the Fit button resets to. */
const FIT_SCALE = 1.0;
const WHEEL_STEP = 0.04;

/**
 * Foreground image overlay rendered on top of the banner gradient. In
 * read-only mode it's just a positioned <img>; in editable mode it
 * becomes a draggable + resizable element:
 *
 *   - Click and drag the image to reposition (debounced PATCH on x/y).
 *   - Scroll wheel anywhere over the image to scale.
 *   - Drag the bottom-right corner handle to scale.
 *   - Click "Fit" to reset scale to 1.0.
 *
 * All scale interactions preserve the image's natural aspect ratio.
 */
export default function SpotlightBannerImage({
  spotlightId,
  url,
  initialPosition,
  initialScale,
  editable,
}: Props) {
  const [pos, setPos] = useState<SpotlightAvatarPosition>(initialPosition);
  const [scale, setScale] = useState<number>(initialScale);
  const [mode, setMode] = useState<"idle" | "move" | "resize">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest values for the debounced save — refs so the same timer
  // captures whatever the user did last (position + scale + both).
  const latest = useRef({ pos: initialPosition, scale: initialScale });

  const schedulePersist = useCallback(() => {
    if (!editable) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/admin/spotlight/${spotlightId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avatar_image_position: latest.current.pos,
            avatar_image_scale: latest.current.scale,
          }),
        });
      } catch {
        // No retry surface — user can repeat the gesture to retry.
      }
    }, SAVE_DEBOUNCE_MS);
  }, [editable, spotlightId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function applyPos(next: SpotlightAvatarPosition) {
    setPos(next);
    latest.current.pos = next;
    schedulePersist();
  }
  function applyScale(next: number) {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    setScale(clamped);
    latest.current.scale = clamped;
    schedulePersist();
  }

  // ── Pointer-drag handlers ─────────────────────────────────────

  const onMovePointerMove = useCallback(
    (e: PointerEvent) => {
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      applyPos({
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function onContainerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    // The resize handle has its own pointerdown which stops propagation,
    // so reaching here implies a move-drag intent.
    e.preventDefault();
    setMode("move");
    document.addEventListener("pointermove", onMovePointerMove);
    const stop = () => {
      setMode("idle");
      document.removeEventListener("pointermove", onMovePointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
  }

  // ── Resize handle (bottom-right corner) ───────────────────────

  // While resizing, scale is derived from the pointer's distance to the
  // image center vs the image center→corner distance at the gesture's
  // start. Multiplying the starting scale by that ratio gives a smooth
  // proportional resize that tracks the pointer.
  const resizeStart = useRef<{ centerX: number; centerY: number; startDist: number; startScale: number } | null>(null);

  const onResizePointerMove = useCallback(
    (e: PointerEvent) => {
      const s = resizeStart.current;
      if (!s) return;
      const dx = e.clientX - s.centerX;
      const dy = e.clientY - s.centerY;
      const dist = Math.hypot(dx, dy);
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
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    resizeStart.current = {
      centerX,
      centerY,
      startDist: Math.hypot(dx, dy),
      startScale: scale,
    };
    setMode("resize");
    document.addEventListener("pointermove", onResizePointerMove);
    const stop = () => {
      setMode("idle");
      resizeStart.current = null;
      document.removeEventListener("pointermove", onResizePointerMove);
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
    const dir = e.deltaY < 0 ? 1 : -1;
    applyScale(scale + dir * WHEEL_STEP);
  }

  // ── Render ────────────────────────────────────────────────────

  const widthPct = BASE_WIDTH_PCT * scale;
  const interactive = editable;
  const isMoving = mode === "move";
  const isResizing = mode === "resize";

  return (
    <div
      ref={containerRef}
      onPointerDown={onContainerPointerDown}
      onWheel={onWheel}
      className={`absolute select-none ${
        interactive
          ? `${isMoving ? "cursor-grabbing" : "cursor-grab"} touch-none`
          : "pointer-events-none"
      }`}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        width: `${widthPct}%`,
        transform: "translate(-50%, -50%)",
        outline:
          interactive && (isMoving || isResizing)
            ? "2px dashed rgba(255,255,255,0.7)"
            : "none",
        outlineOffset: 4,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        draggable={false}
        className="w-full h-auto drop-shadow-lg block"
      />

      {/* Resize handle — visible only when editable. Sits at the
          bottom-right of the image bounding box. */}
      {interactive && (
        <button
          type="button"
          aria-label="Resize banner image"
          onPointerDown={onResizePointerDown}
          // Stop drag clicks from also firing the parent move handler.
          onClick={(e) => e.stopPropagation()}
          className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-white border-2 border-black/40 shadow flex items-center justify-center cursor-nwse-resize"
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

/** Fit-to-default scale value, exported so the admin bar can call back
 *  in to reset via the same PATCH payload shape. */
export const SPOTLIGHT_FIT_SCALE = FIT_SCALE;
