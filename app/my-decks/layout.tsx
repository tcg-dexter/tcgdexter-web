/**
 * Both routes under this segment (the collection index and each deck's
 * detail page) stream behind a `loading.tsx` skeleton that's much shorter
 * than the real content — deck count and match history vary per user, so
 * there's no fixed height to match.
 *
 * On a hard refresh, the browser's default scroll restoration
 * (history.scrollRestoration = "auto") reapplies the pre-refresh scrollY
 * against whatever is currently painted. If that happens to be the short
 * skeleton, the browser clamps near its bottom; the real, taller content
 * then streams in underneath without re-correcting, landing the page far
 * past its actual top — visually indistinguishable from "the scroll
 * position is anchored to the bottom."
 *
 * A client-side effect can flip `scrollRestoration` to "manual" and snap
 * back to the top too, but only after hydration — by then the browser may
 * have already committed to restoring against the short skeleton. This
 * inline script runs synchronously as the browser parses the HTML, before
 * hydration and before the browser's own restoration logic has a chance
 * to act on the still-"auto" flag, so it reliably wins the race. (A
 * next/script tag defers execution and would reintroduce the same race —
 * this needs a plain, parser-inserted <script>.)
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
      {children}
    </>
  );
}
