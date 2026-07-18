/**
 * Minimal footer rendered by the root layout on every page.
 *
 * `overflow-anchor: none` opts the footer out of being chosen as the
 * browser's scroll anchor. The footer is persistent site chrome that sits
 * directly below every page's main content, so when that content changes
 * height (e.g. a grid ↔ list view toggle, or an image-driven reflow) the
 * browser would otherwise sometimes pin the *footer* in place and scroll
 * the viewport to compensate — dragging the user to the bottom of the
 * page. Excluding the footer lets scroll anchoring do its real job:
 * keeping whatever content element the user is actually looking at
 * stable. This is the intended use of the property (mark non-content
 * chrome as a non-anchor), not a blanket disable.
 */
export default function SiteFooter() {
  return (
    <footer className="[overflow-anchor:none]">
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-text-muted">
        <div>© 2026 TCG Dexter · tcgdexter.com</div>
        <div className="flex items-center gap-6">
          <a href="mailto:feedback@tcgdexter.com" className="hover:text-text-primary transition">
            feedback@tcgdexter.com
          </a>
        </div>
      </div>
    </footer>
  );
}
