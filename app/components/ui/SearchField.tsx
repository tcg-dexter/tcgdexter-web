"use client";

/**
 * The rounded search input used by the Cards page's toolbars — a leading
 * magnifier glyph over a capsule field with the shared gradient focus ring.
 *
 * Extracted so the Cards and Sets tabs render the identical control rather
 * than two copies that drift apart. The 16px base font size is deliberate:
 * anything smaller triggers iOS Safari's auto-zoom on focus, so the sm+
 * breakpoint is where it drops to text-sm.
 */
export default function SearchField({
  value,
  onChange,
  placeholder,
  className = "flex-1 relative",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Wrapper classes — the glyph is positioned against this box. */
  className?: string;
}) {
  return (
    <div className={className}>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m17 17-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
      />
    </div>
  );
}
