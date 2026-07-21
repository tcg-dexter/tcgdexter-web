/**
 * Skeleton primitives — tiny building blocks used by route-level loading.tsx
 * shells while a server component awaits Supabase. Subtle pulse on bg-black/5
 * so the placeholder reads as "loading" without competing with real chrome.
 *
 * Sizes intentionally match real content (card radius, border, line heights)
 * so the swap from skeleton → real HTML doesn't shift layout.
 */

export function SkeletonLine({
  width = "w-24",
  height = "h-3",
  className = "",
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block rounded bg-black/5 dark:bg-white/10 animate-pulse ${width} ${height} ${className}`}
    />
  );
}

export function SkeletonCircle({
  size = "w-8 h-8",
  className = "",
}: {
  size?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block rounded-full bg-black/5 dark:bg-white/10 animate-pulse flex-shrink-0 ${size} ${className}`}
    />
  );
}

export function SkeletonBlock({
  className = "",
  height = "h-24",
}: {
  className?: string;
  height?: string;
}) {
  return (
    <div
      aria-hidden
      className={`rounded-lg bg-black/5 dark:bg-white/10 animate-pulse ${height} ${className}`}
    />
  );
}

/**
 * Card shell that matches the real `rounded-2xl border border-black/8
 * bg-white/90 backdrop-blur-xl shadow-sm` chrome used across DeckProfileView,
 * profile pages, and the leaderboard. Skeleton blocks go inside.
 */
export function SkeletonCard({
  children,
  className = "",
  padding = "p-5",
}: {
  children?: React.ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm ${padding} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * List row matching the leaderboard / profile-decks row layout:
 *   [badge] [primary line + secondary line] [trailing meta]
 * Used inside an outer card with dividers between rows.
 */
export function SkeletonRow({
  showBadge = true,
  showTrailing = true,
  className = "",
}: {
  showBadge?: boolean;
  showTrailing?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 py-4 ${className}`}>
      {showBadge && <SkeletonCircle size="w-8 h-8" />}
      <div className="flex-1 min-w-0 space-y-2">
        <SkeletonLine width="w-1/2" height="h-3.5" />
        <SkeletonLine width="w-1/3" height="h-2.5" />
      </div>
      {showTrailing && <SkeletonLine width="w-16" height="h-3" />}
    </div>
  );
}
