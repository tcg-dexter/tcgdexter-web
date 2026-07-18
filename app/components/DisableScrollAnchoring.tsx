/**
 * Drop into a route segment's layout.tsx to prevent the "scroll jumps to
 * the bottom" bug on routes that stream behind a short loading.tsx
 * skeleton in front of real content whose height varies a lot (a deck
 * grid with an unknown number of cards, a profile bio of unknown length,
 * etc.).
 *
 * Root cause: the browser's default CSS scroll anchoring picks an
 * in-flow element as an "anchor node" and tries to keep it visually
 * stable across DOM changes. The root layout renders <SiteFooter />
 * immediately after {children}, so while the short skeleton is up the
 * footer sits near the top of the viewport — a natural anchor pick. When
 * the skeleton is replaced by real, much-taller content (or the content
 * itself changes shape, e.g. a grid/list toggle), the footer's document
 * position jumps by thousands of pixels, and scroll anchoring
 * compensates by scrolling the viewport down to keep the footer in the
 * same screen position — landing at the bottom of the new content.
 *
 * `overflow-anchor: none` on <html> alone does NOT fix this: the root
 * layout's wrapper div uses `overflow-x-hidden`, and per CSS spec, when
 * overflow-x is not-visible and overflow-y is visible, BOTH compute to
 * `auto` — making that div its own scroll container, distinct from
 * <html>. The robust fix is a `* { overflow-anchor: none }` rule, which
 * opts every element on the page out of anchor-node candidacy regardless
 * of which element ends up being the actual scroll container. Rendered
 * as a plain (non-next/script) <style>/<script> pair so both land in the
 * server-rendered HTML and run before the browser ever assigns an
 * anchor — a client-side effect fires too late, after the browser may
 * have already committed to a bad scroll position.
 *
 * The inline <script> is a second, independent fix: on a hard refresh,
 * the browser's default scroll restoration (history.scrollRestoration =
 * "auto") reapplies the pre-refresh scrollY against whatever's currently
 * painted — if that's the short skeleton, it clamps near its bottom
 * before real content even streams in. Flipping the flag to "manual" as
 * early as possible prevents that too.
 *
 * Known good on: /my-decks (+ /my-decks/[id]), /u/[username]
 * (+ /u/[username]/[deckId]).
 */
const INIT_SCRIPT = `try{
if("scrollRestoration" in window.history){window.history.scrollRestoration="manual";}
document.documentElement.style.overflowAnchor="none";
if(document.body)document.body.style.overflowAnchor="none";
}catch(e){}`;

export default function DisableScrollAnchoring() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      <style dangerouslySetInnerHTML={{ __html: `*{overflow-anchor:none}` }} />
    </>
  );
}
