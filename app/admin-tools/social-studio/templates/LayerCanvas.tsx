import { CANVAS_H, CANVAS_W, type StudioLayer } from "./types";

interface Props {
  layers: StudioLayer[];
  /** Layer ids to skip when compositing (editor visibility toggles). */
  hiddenIds?: ReadonlySet<string>;
  /** Canvas dimensions. Default to the 9:16 size; the spotlight thumbnail
   *  passes its 5:4 size. */
  width?: number;
  height?: number;
}

/** Stacks a template's layers on its canvas. Each layer gets a full-canvas
 *  wrapper so layer nodes keep the same coordinate space whether composited
 *  together or rendered alone for export. The canvas itself has no
 *  background — that's the job of each template's "background" layer, which
 *  is what makes single-layer PNG exports transparent. */
export default function LayerCanvas({
  layers,
  hiddenIds,
  width = CANVAS_W,
  height = CANVAS_H,
}: Props) {
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        fontFamily: "var(--font-sans, system-ui)",
        color: "#fff",
      }}
    >
      {layers
        .filter((l) => !hiddenIds?.has(l.id))
        .map((l) => (
          <div key={l.id} style={{ position: "absolute", inset: 0 }}>
            {l.node}
          </div>
        ))}
    </div>
  );
}
