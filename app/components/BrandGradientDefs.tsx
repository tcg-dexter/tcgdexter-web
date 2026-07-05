/**
 * Renders the site's brand gradient (see `--gradient-brand` in globals.css)
 * as a reusable SVG <linearGradient> def, referenced via `url(#brandGradient)`
 * from any SVG stroke/fill that wants the brand look (CSS gradients can't be
 * used as an SVG paint value directly). Mount once near the root of a page
 * that uses it — ids are global to the document, so multiple mounts would
 * collide.
 */
export default function BrandGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="brandGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#F2A20C" />
          <stop offset="50%" stopColor="#D91E0D" />
          <stop offset="100%" stopColor="#A60D0D" />
        </linearGradient>
      </defs>
    </svg>
  );
}
