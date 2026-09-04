/**
 * Certified Trainer badge — awarded for 10/10 on the Trainer Quiz.
 *
 * Pure inline SVG so it renders identically on the quiz "earned" view
 * and on the profile Achievements card. `size` toggles between the
 * compact profile-row version and the hero version on the quiz page.
 */
export default function CertifiedTrainerBadge({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const px = size === "lg" ? 112 : size === "md" ? 56 : 40;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 112 112"
      fill="none"
      role="img"
      aria-label="Certified Trainer badge"
      className="shrink-0"
    >
      <defs>
        <radialGradient id="ct-fill" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#D99B29" />
          <stop offset="55%" stopColor="#8C2711" />
          <stop offset="100%" stopColor="#7A0808" />
        </radialGradient>
        <linearGradient id="ct-ring" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Outer ring */}
      <circle cx="56" cy="56" r="54" fill="url(#ct-fill)" />
      <circle
        cx="56"
        cy="56"
        r="53"
        fill="none"
        stroke="url(#ct-ring)"
        strokeWidth="2"
      />

      {/* Inner medallion */}
      <circle cx="56" cy="56" r="42" fill="#FFFFFF" fillOpacity="0.1" />
      <circle
        cx="56"
        cy="56"
        r="42"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.35"
        strokeWidth="1"
      />

      {/* Checkmark */}
      <path
        d="M38 58 L52 72 L78 42"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
