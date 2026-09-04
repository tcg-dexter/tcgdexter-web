/**
 * Renders the site's brand gradient (see `--gradient-brand` in globals.css)
 * as a reusable SVG <linearGradient> def, referenced via `url(#brandGradient)`
 * from any SVG stroke/fill that wants the brand look (CSS gradients can't be
 * used as an SVG paint value directly). Mount once near the root of a page
 * that uses it — ids are global to the document, so multiple mounts would
 * collide.
 *
 * Its only current consumer, CompositionRing, renders inside an <svg> that's
 * CSS-rotated -90deg (so the ring's stroke-dasharray math can start at 12
 * o'clock). That rotation also rotates this gradient's rendered direction,
 * so it's defined here pre-rotated +90deg (gradientTransform, userSpaceOnUse
 * matching CompositionRing's 58x58 viewBox) so it nets out left-to-right on
 * screen. If a non-rotated consumer needs this gradient too, give it its own
 * unrotated def rather than reusing this one.
 */
export default function BrandGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient
          id="brandGradient"
          gradientUnits="userSpaceOnUse"
          x1="5"
          y1="29"
          x2="53"
          y2="29"
          gradientTransform="rotate(90 29 29)"
        >
          <stop offset="0%" stopColor="#D99B29" />
          <stop offset="100%" stopColor="#8C2711" />
        </linearGradient>
      </defs>
    </svg>
  );
}
