"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpotlightAvatarPosition } from "../types";

interface Props {
  spotlightId: string;
  url: string;
  initialPosition: SpotlightAvatarPosition;
  /** When true, the image can be dragged. PATCHes the new x/y to the API
   *  on drop. Driven by the preview page when the viewer is admin. */
  editable: boolean;
}

const SAVE_DEBOUNCE_MS = 600;
/** Image width as a fraction of banner width — keeps the avatar at a
 *  consistent visual weight regardless of viewport. */
const IMAGE_WIDTH_PCT = 32;

/**
 * Foreground image overlay rendered on top of the banner gradient. In
 * read-only mode it's just a positioned <img>; in editable mode it
 * becomes a pointer-draggable element that persists its new x/y
 * percentage coordinates after the drag settles.
 */
export default function SpotlightBannerImage({
  spotlightId,
  url,
  initialPosition,
  editable,
}: Props) {
  const [pos, setPos] = useState<SpotlightAvatarPosition>(initialPosition);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist new position after the user pauses dragging. Debounced so a
  // rapid sequence of drags only fires one request.
  const schedulePersist = useCallback(
    (next: SpotlightAvatarPosition) => {
      if (!editable) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await fetch(`/api/admin/spotlight/${spotlightId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatar_image_position: next }),
          });
        } catch {
          // No retry surface — user can drag again to retry.
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [editable, spotlightId],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Pointer drag handler. Uses pointer events so mouse + touch + pen
  // all flow through the same code path. The container is the banner
  // itself (passed in via ref by SpotlightHeader); we resolve the
  // pointer's position relative to its bounding rect and convert to
  // percentages. Clamp 0-100 so the image center stays inside the banner.
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const clamped: SpotlightAvatarPosition = {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      };
      setPos(clamped);
      schedulePersist(clamped);
    },
    [schedulePersist],
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    document.addEventListener("pointermove", onPointerMove);
    const stop = () => {
      setDragging(false);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      className={`absolute select-none ${
        editable
          ? `${dragging ? "cursor-grabbing" : "cursor-grab"} touch-none`
          : "pointer-events-none"
      }`}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        width: `${IMAGE_WIDTH_PCT}%`,
        transform: "translate(-50%, -50%)",
        // While dragging, give a subtle ring so the user sees they're
        // moving the right thing. Stays clean in read-only mode.
        outline: editable && dragging ? "2px dashed rgba(255,255,255,0.7)" : "none",
        outlineOffset: 4,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        draggable={false}
        className="w-full h-auto drop-shadow-lg"
      />
    </div>
  );
}
