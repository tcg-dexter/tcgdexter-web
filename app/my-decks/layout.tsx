/**
 * Both routes under this segment (the collection index and each deck's
 * detail page) stream behind a `loading.tsx` skeleton that's much shorter
 * than the real content — deck count and match history vary per user, so
 * there's no fixed height to match.
 *
 * Wrapping `{children}` in a container with `overflow-anchor: none` is the
 * primary fix here: when the Suspense boundary swaps the skeleton fallback
 * for the real content, that's a full subtree replacement, not an
 * incremental resize. The browser's default CSS scroll anchoring tries to
 * keep whatever "anchor node" it had picked inside the (about-to-be-
 * destroyed) skeleton visually stable across the swap — recalculating an
 * anchor across a full subtree replacement like this is exactly the case
 * scroll anchoring handles badly, and it can compensate with a scroll jump
 * to the bottom of the newly-inserted content the instant the swap
 * happens. `overflow-anchor: none` opts this whole subtree out of
 * anchor-node candidacy — since this div is a stable ancestor that
 * persists across the skeleton → real-content swap, the property covers
 * both without needing to touch loading.tsx and the real page separately.
 *
 * The inline script below is a secondary, unrelated fix for a different
 * failure mode: on a hard refresh, the browser's default scroll
 * restoration (history.scrollRestoration = "auto") reapplies the
 * pre-refresh scrollY against whatever's currently painted — if that's
 * the short skeleton, it clamps near its bottom before the real content
 * even streams in. Flipping the flag as early as possible (a plain
 * parser-inserted <script>, not next/script, which defers) prevents that
 * independently of the anchoring fix above.
 */
const DISABLE_SCROLL_RESTORATION = `try{if("scrollRestoration" in window.history){window.history.scrollRestoration="manual";}}catch(e){}`;

export default function MyDecksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: DISABLE_SCROLL_RESTORATION }} />
      <div className="[overflow-anchor:none]">{children}</div>
    </>
  );
}
