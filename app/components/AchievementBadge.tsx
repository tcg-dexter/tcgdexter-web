import Image from "next/image";
import type { AchievementDef } from "@/lib/learn/achievements";

/**
 * A single achievement medallion + label. Each badge is a hosted PNG at
 * `/badges/<key>.png` (300×300 art). Earned badges render in full color;
 * locked badges are desaturated and dimmed.
 */

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
        <Image
          src={`/badges/${def.key}.png`}
          alt={`${def.name} badge${earned ? "" : " (locked)"}`}
          width={px}
          height={px}
          className="shrink-0"
        />
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
