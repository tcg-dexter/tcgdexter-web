/**
 * Both routes under this segment (the collection index and each deck's
 * detail page) stream behind a `loading.tsx` skeleton that's much shorter
 * than the real content — deck count and match history vary per user, so
 * there's no fixed height to match.
 *
 * The scroll-to-bottom bug at skeleton → real-content swap:
 * ─────────────────────────────────────────────────────────
 * The root layout renders <SiteFooter /> immediately AFTER {children}, in
 * normal flow. While the short skeleton is up, the footer sits somewhere
 * near the top of the viewport. The browser's default CSS scroll
 * anchoring picks an in-flow element (in practice, the footer or a
 * descendant of it) as the "anchor node" and tries to keep it visually
 * stable when the DOM changes.
 *
 * When Suspense swaps the skeleton for real content, the wrapper grows
 * from a few hundred px to a few thousand — the footer's document
 * position jumps down by the same amount. Scroll anchoring compensates
 * by scrolling the viewport down to keep the footer visually stable,
 * which lands the page exactly at the bottom of the newly-inserted
 * content. That matches the report exactly.
 *
 * A previous attempt applied `overflow-anchor: none` to a wrapper div
 * INSIDE {children}. That doesn't help: the footer is a sibling of that
 * wrapper, not a descendant, and can still be picked as the anchor.
 * `overflow-anchor: none` must be on the SCROLL CONTAINER (or on the
 * anchor candidate itself) to actually disable the mechanism. The scroll
 * container here is <html>, so we inject an inline <style> that opts it
 * out — scoped to this route because it's the only one with the
 * short-skeleton → tall-content transition. React renders this style tag
 * during SSR, so it's in the initial HTML before the browser ever assigns
 * an anchor.
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
      <style>{`html{overflow-anchor:none}`}</style>
      {children}
    </>
  );
}
