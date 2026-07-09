"use client";

/**
 * Two-state toggle capsule with an animated slider that translates between
 * the Grid and List positions. Used by the deck-collection toolbar and the
 * card-catalog toolbar so the two surfaces read as the same control.
 *
 * The slider is an absolutely-positioned overlay driven by CSS transform;
 * button text colors flip based on which side is active (grid → white slider,
 * dark text; list → black slider, white text). Sits at h-[38px] by default
 * so it aligns with the shared 38-px toolbar row height on both callsites.
 */
export default function GridListToggle({
  value,
  onChange,
  className = "h-[38px]",
}: {
  value: "grid" | "list";
  onChange: (view: "grid" | "list") => void;
  /** Extra classes on the outer capsule — defaults to the toolbar height. */
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center ${className} rounded-full bg-black/5 p-[3px]`}
      role="tablist"
    >
      <div
        aria-hidden
        className={`absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full shadow-sm transition-all duration-300 ease-in-out ${
          value === "grid" ? "translate-x-0 bg-white" : "translate-x-full bg-black"
        }`}
      />
      <button
        type="button"
        role="tab"
        aria-selected={value === "grid"}
        aria-label="Grid view"
        onClick={() => onChange("grid")}
        className={`relative z-10 h-full flex-1 flex items-center justify-center px-3.5 rounded-full text-xs font-bold transition-colors ${
          value === "grid" ? "text-text-primary" : "text-text-muted"
        }`}
      >
        Grid
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "list"}
        aria-label="List view"
        onClick={() => onChange("list")}
        className={`relative z-10 h-full flex-1 flex items-center justify-center px-3.5 rounded-full text-xs font-bold transition-colors ${
          value === "list" ? "text-white" : "text-text-muted"
        }`}
      >
        List
      </button>
    </div>
  );
}
