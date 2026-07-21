import { SkeletonLine } from "./Skeleton";

const CARD_CLS =
  "rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden";

function SettingsRow() {
  return (
    <div className="px-5 py-4 border-b border-black/5 dark:border-white/10 last:border-b-0">
      <SkeletonLine width="w-24" height="h-3" className="mb-2" />
      <SkeletonLine width="w-48" height="h-4" />
    </div>
  );
}

/**
 * Mirrors /settings — two grouped cards (Account, Profile) with rows inside.
 */
export default function SettingsSkeleton() {
  return (
    <>
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Account
        </p>
        <div className={CARD_CLS}>
          <SettingsRow />
          <SettingsRow />
        </div>
      </div>

      <div className="mt-6 mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted px-1 mb-2">
          Profile
        </p>
        <div className={CARD_CLS}>
          <SettingsRow />
          <SettingsRow />
        </div>
      </div>
    </>
  );
}
