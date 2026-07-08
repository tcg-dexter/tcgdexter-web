/**
 * Scroll-jump-to-bottom on /my-decks (and /my-decks/[id]):
 * ────────────────────────────────────────────────────────
 * Two triggers, one root cause. First: the segment streams behind a
 * `loading.tsx` skeleton that's much shorter than the real content, so
 * the skeleton → real swap is a big height increase. Second: the view
 * toggle (grid ↔ list) also swaps two very-different-height renderings
 * of the same deck list. In both cases the browser's default CSS scroll
 * anchoring picks an in-flow element below the change area (in
 * practice, <SiteFooter /> or a descendant, which the root layout
 * renders right after {children}), and when that element's document
 * position jumps by ~2000px the browser scrolls the viewport to keep
 * the anchor visually stable — landing the page at the bottom of the
 * newly-inserted content.
 *
 * Previous attempts to disable anchoring failed because they didn't
 * target the actual scroll container. The root layout's wrapper is
 * <div class="... overflow-x-hidden ...">, and per CSS spec, when
 * overflow-x is not-visible and overflow-y is visible, BOTH compute to
 * `auto` — so that wrapper is itself a scroll container. Setting
 * `overflow-anchor: none` on <html> doesn't apply to nested scroll
 * containers; it needs to be set on the actual container (or on every
 * possible anchor node).
 *
 * The simplest robust fix, scoped to this route only, is to opt every
 * element out of scroll-anchor candidacy via `* { overflow-anchor:
 * none }` (which the CSS spec confirms disables anchoring). React
 * renders this <style> during SSR so it's in the initial HTML before
 * the browser assigns an anchor for the very first paint. The inline
 * script alongside runs synchronously as the browser parses,
 * imperatively setting the property on <html> and <body> as
 * belt-and-suspenders in case the style tag is somehow deferred, and
 * also flipping history.scrollRestoration to "manual" for the
 * hard-refresh case that was the original bug report.
 */
const INIT_SCRIPT = `try{
if("scrollRestoration" in window.history){window.history.scrollRestoration="manual";}
document.documentElement.style.overflowAnchor="none";
if(document.body)document.body.style.overflowAnchor="none";
}catch(e){}`;

export default function MyDecksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      <style
        dangerouslySetInnerHTML={{
          __html: `*{overflow-anchor:none}`,
        }}
      />
      {children}
    </>
  );
}
