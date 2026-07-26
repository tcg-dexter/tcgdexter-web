/**
 * Flame glyph + streak count. Shared by the log-time celebration toast and
 * the profile "Day Streak" tile so the two read as the same object.
 */
export default function StreakFlame({
  count,
  size = "md",
  className = "",
  showCount = true,
}: {
  count: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  showCount?: boolean;
}) {
  const flame =
    size === "lg" ? "h-7 w-7" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const num =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  // Muted (grey) when the streak has lapsed to 0, warm gradient when alive.
  const alive = count > 0;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <svg viewBox="0 0 24 24" className={flame} aria-hidden="true">
        <defs>
          <linearGradient id="streakFlameGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F2A20C" />
            <stop offset="1" stopColor="#D91E0D" />
          </linearGradient>
        </defs>
        <path
          fill={alive ? "url(#streakFlameGrad)" : "currentColor"}
          className={alive ? "" : "text-text-muted/50"}
          d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177 7.547 7.547 0 01-1.705-1.715.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.547 3.75 3.75 0 013.255 3.718z"
        />
      </svg>
      {showCount && (
        <span className={`font-bold tabular-nums text-text-primary ${num}`}>
          {count}
        </span>
      )}
    </span>
  );
}
