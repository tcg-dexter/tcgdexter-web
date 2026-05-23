import Link from "next/link";

interface Props {
  href: string;
  ariaLabel: string;
  className?: string;
}

/**
 * Circular translucent back button. Originated as the banner overlay on
 * meta archetype pages and is now the standard across the site — pages
 * without a banner mount it at the top-left of their main scroll area.
 */
export default function BackButton({ href, ariaLabel, className = "" }: Props) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 transition-colors shadow-sm ${className}`}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
    </Link>
  );
}
