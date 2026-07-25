import type { AchievementCategory, AchievementDef } from "@/lib/learn/achievements";
import CertifiedTrainerBadge from "@/app/learn/quiz/CertifiedTrainerBadge";

/**
 * A single achievement medallion + label. Earned badges render in their
 * category color; locked badges are desaturated with a small lock. The
 * Certified Trainer badge keeps its bespoke SVG (special-cased) so its
 * established look carries over from the quiz flow.
 */

const CATEGORY_GRADIENT: Record<AchievementCategory, [string, string, string]> =
  {
    // teal → emerald
    "Getting Started": ["#5EEAD4", "#10B981", "#047857"],
    // brand fire (amber → red) — reads as "battle"
    "Match Grind": ["#F2A20C", "#D91E0D", "#7A0808"],
    // sky → indigo
    "Deck Builder": ["#93C5FD", "#4F46E5", "#3730A3"],
  };

const LOCKED_GRADIENT: [string, string, string] = ["#D1D5DB", "#9CA3AF", "#6B7280"];

/** For a milestone key (matches_10, decks_5, …) the threshold number to
 *  print inside the medallion; null for the intro "first_*" badges. */
function milestoneNumber(key: string): string | null {
  const m = /_(\d+)$/.exec(key);
  return m ? m[1] : null;
}

export default function AchievementBadge({
  def,
  earned,
  size = "md",
}: {
  def: AchievementDef;
  earned: boolean;
  size?: "sm" | "md";
}) {
  const px = size === "md" ? 64 : 48;

  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      <div
        className={
          earned
            ? "transition-opacity"
            : "opacity-45 grayscale transition-opacity"
        }
      >
        {def.key === "certified_trainer" ? (
          // Bespoke badge — scale the lg (112px) art down to our medallion
          // footprint via a wrapper so it lines up with the others.
          <div style={{ width: px, height: px }} className="flex items-center justify-center">
            <CertifiedTrainerBadge size={size === "md" ? "md" : "sm"} />
          </div>
        ) : (
          <Medallion def={def} earned={earned} px={px} />
        )}
      </div>
      <p
        className={`text-[11px] leading-tight font-semibold text-center max-w-[5.5rem] ${
          earned ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {def.name}
      </p>
    </div>
  );
}

function Medallion({
  def,
  earned,
  px,
}: {
  def: AchievementDef;
  earned: boolean;
  px: number;
}) {
  const [c0, c1, c2] = earned ? CATEGORY_GRADIENT[def.category] : LOCKED_GRADIENT;
  const num = milestoneNumber(def.key);
  const fillId = `badge-fill-${def.key}`;
  const ringId = `badge-ring-${def.key}`;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 112 112"
      fill="none"
      role="img"
      aria-label={`${def.name} badge${earned ? "" : " (locked)"}`}
      className="shrink-0"
    >
      <defs>
        <radialGradient id={fillId} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor={c0} />
          <stop offset="55%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </radialGradient>
        <linearGradient id={ringId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Outer ring */}
      <circle cx="56" cy="56" r="54" fill={`url(#${fillId})`} />
      <circle cx="56" cy="56" r="53" fill="none" stroke={`url(#${ringId})`} strokeWidth="2" />

      {/* Inner medallion */}
      <circle cx="56" cy="56" r="42" fill="#FFFFFF" fillOpacity="0.1" />
      <circle cx="56" cy="56" r="42" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1" />

      {num ? (
        <text
          x="56"
          y="57"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#FFFFFF"
          fontSize={num.length >= 3 ? 34 : 42}
          fontWeight="800"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {num}
        </text>
      ) : (
        // Intro "first_*" badges — a star marks the starter set.
        <path
          d="M56 32 L64 50 L84 52 L69 66 L73 86 L56 76 L39 86 L43 66 L28 52 L48 50 Z"
          fill="#FFFFFF"
          fillOpacity="0.95"
        />
      )}
    </svg>
  );
}
