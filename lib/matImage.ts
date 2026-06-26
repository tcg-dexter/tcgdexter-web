/**
 * A user-uploaded image placed as a playmat background. Everything here is
 * held in-memory client-side only (the src is a data URL) — never persisted,
 * stored, or uploaded to the server.
 */
export interface MatImage {
  /** Data URL of the uploaded image (kept in-browser only). */
  src: string;
  naturalW: number;
  naturalH: number;
  /** Scale multiplier over the cover-fit baseline (>= 1). */
  zoom: number;
  /** Horizontal focal position, 0 (left) … 1 (right). 0.5 = centered. */
  panX: number;
  /** Vertical focal position, 0 (top) … 1 (bottom). 0.5 = centered. */
  panY: number;
}

export interface ImagePlacement {
  dispW: number;
  dispH: number;
  drawX: number;
  drawY: number;
}

/**
 * Resolve a MatImage's pan/zoom into concrete draw coordinates for a mat of
 * the given pixel dimensions. The image always *covers* the mat (no gaps):
 * a cover-fit baseline scale is multiplied by `zoom`, and pan shifts the
 * (necessarily oversized) image within the clamped range so the mat stays
 * fully covered. Shared by the live preview (<img>) and the canvas export
 * (drawImage) so both render identically.
 */
export function computeImagePlacement(
  matW: number,
  matH: number,
  natW: number,
  natH: number,
  zoom: number,
  panX: number,
  panY: number,
): ImagePlacement {
  if (!natW || !natH || matW <= 0 || matH <= 0) {
    return { dispW: matW, dispH: matH, drawX: 0, drawY: 0 };
  }
  const coverScale = Math.max(matW / natW, matH / natH);
  const drawScale = coverScale * Math.max(1, zoom);
  const dispW = natW * drawScale;
  const dispH = natH * drawScale;
  // (matW - dispW) <= 0; panX in [0,1] slides across the overflow.
  const drawX = (matW - dispW) * clamp01(panX);
  const drawY = (matH - dispH) * clamp01(panY);
  return { dispW, dispH, drawX, drawY };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Read a user-selected image file fully in-browser (FileReader → data URL)
 * and resolve a MatImage with cover-fit defaults (zoom 1, centered). Nothing
 * is uploaded or stored server-side. Rejects on a non-image or read failure.
 */
export function readImageFile(file: File): Promise<MatImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () =>
        resolve({
          src: dataUrl,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          zoom: 1,
          panX: 0.5,
          panY: 0.5,
        });
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
