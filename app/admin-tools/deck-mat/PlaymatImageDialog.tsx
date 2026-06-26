"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { computeImagePlacement, readImageFile, type MatImage } from "@/lib/matImage";

interface Props {
  open: boolean;
  /** Image to seed the editor with (a fresh upload draft, or the placed
   *  image being re-edited). */
  initial: MatImage | null;
  /** Mat aspect ratio (height / width) so the editor surface matches. */
  aspect: number;
  /** Whether an image is already placed as the mat background — controls
   *  whether the Remove action is offered. */
  placed: boolean;
  onClose: () => void;
  onSave: (img: MatImage) => void;
  /** Clear any placed image and revert the mat to its gradient/pattern. */
  onRemove: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * Client-only image placement editor for the playmat. The user uploads an
 * image (read in-browser as a data URL — never sent anywhere), which fills
 * the mat by default; they drag to reposition and use a slider to scale up,
 * then Save to set it as the mat background. Pan is clamped so the mat is
 * always fully covered.
 */
export default function PlaymatImageDialog({
  open,
  initial,
  aspect,
  placed,
  onClose,
  onSave,
  onRemove,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0.5);
  const [panY, setPanY] = useState(0.5);
  const [error, setError] = useState<string | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceW, setSurfaceW] = useState(0);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  // Re-seed from `initial` whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSrc(initial.src);
      setNatural({ w: initial.naturalW, h: initial.naturalH });
      setZoom(initial.zoom);
      setPanX(initial.panX);
      setPanY(initial.panY);
    } else {
      setSrc(null);
      setNatural(null);
      setZoom(1);
      setPanX(0.5);
      setPanY(0.5);
    }
    setError(null);
  }, [open, initial]);

  // Measure the editor surface so drag math maps pixels → pan fractions.
  useLayoutEffect(() => {
    if (!open) return;
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSurfaceW(entry.contentRect.width),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  async function handleFile(file: File) {
    try {
      const draft = await readImageFile(file);
      setSrc(draft.src);
      setNatural({ w: draft.naturalW, h: draft.naturalH });
      setZoom(1);
      setPanX(0.5);
      setPanY(0.5);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    }
  }

  const surfaceH = surfaceW * aspect;
  const placement =
    natural && surfaceW > 0
      ? computeImagePlacement(
          surfaceW,
          surfaceH,
          natural.w,
          natural.h,
          zoom,
          panX,
          panY,
        )
      : null;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!src) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
    },
    [src, panX, panY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || !natural || surfaceW <= 0) return;
      const surfaceHLocal = surfaceW * aspect;
      const { dispW, dispH } = computeImagePlacement(
        surfaceW,
        surfaceHLocal,
        natural.w,
        natural.h,
        zoom,
        panX,
        panY,
      );
      const overflowX = dispW - surfaceW; // >= 0
      const overflowY = dispH - surfaceHLocal;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      // Dragging right reveals the left side → focal point moves left.
      if (overflowX > 0) {
        setPanX(clamp01(d.panX - dx / overflowX));
      }
      if (overflowY > 0) {
        setPanY(clamp01(d.panY - dy / overflowY));
      }
    },
    [natural, surfaceW, aspect, zoom, panX, panY],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  function handleSave() {
    if (!src || !natural) return;
    onSave({
      src,
      naturalW: natural.w,
      naturalH: natural.h,
      zoom,
      panX,
      panY,
    });
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="playmat-image-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-white/95 backdrop-blur-xl border border-black/5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-black/5">
          <h2
            id="playmat-image-title"
            className="text-base font-semibold text-text-primary"
          >
            {src ? "Position image" : "Add image"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-text-muted hover:bg-black/5 hover:text-text-primary transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Editor surface */}
          <div
            ref={surfaceRef}
            className="relative w-full overflow-hidden rounded-xl bg-[var(--surface)] touch-none select-none"
            style={{ height: surfaceW > 0 ? surfaceH : undefined, minHeight: 160 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {src && placement ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="absolute cursor-move"
                  style={{
                    left: placement.drawX,
                    top: placement.drawY,
                    width: placement.dispW,
                    height: placement.dispH,
                    maxWidth: "none",
                  }}
                />
                {/* Subtle framing hint */}
                <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10 rounded-xl" />
              </>
            ) : (
              <label className="absolute inset-0 flex flex-col items-center justify-center gap-2 cursor-pointer text-text-muted">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-1.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5" />
                </svg>
                <span className="text-sm font-medium">Upload an image</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {/* Zoom slider */}
          {src && (
            <div className="mt-4">
              <label className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted w-12">
                  Size
                </span>
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="flex-1 accent-accent"
                />
              </label>
              <p className="mt-2 text-[11px] text-text-muted">
                Drag the image to reposition. It always fills the mat — nothing
                is uploaded or stored.
              </p>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-accent">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-black/5 flex items-center gap-2">
          {src && (
            <label className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition cursor-pointer">
              Replace
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {placed && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-accent hover:bg-black/5 transition"
            >
              Remove
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!src}
              className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-light transition disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
