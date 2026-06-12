import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toPng } from "html-to-image";
import LayerCanvas from "./templates/LayerCanvas";
import { CANVAS_H, CANVAS_W, type StudioLayer } from "./templates/types";

/** Render the given layers offscreen at full 1080×1920 and rasterize them
 *  to a PNG data URL. Layers render exactly as in the editor; when the
 *  template's background layer isn't in the list the PNG comes out with
 *  a transparent backdrop — that's what makes per-layer exports usable
 *  as animation plates. */
export async function rasterizeLayers(layers: StudioLayer[]): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<LayerCanvas layers={layers} />);
    });
    // Wait for every <img> to decode — card art renders height:auto, so
    // capturing before load would collapse the images to zero height.
    await Promise.all(
      Array.from(host.querySelectorAll("img")).map((img) =>
        img.decode().catch(() => undefined),
      ),
    );
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    return await toPng(host.firstElementChild as HTMLElement, {
      width: CANVAS_W,
      height: CANVAS_H,
      pixelRatio: 1,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset"
  );
}
