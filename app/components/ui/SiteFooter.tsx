/**
 * Minimal footer rendered by the root layout on every page.
 */
export default function SiteFooter() {
  return (
    <footer>
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
