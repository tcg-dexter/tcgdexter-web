"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Wraps the deck-profile modules that sit below the battle history. Uses
 * Framer Motion's `layout` so the whole block magic-moves to its new
 * position when the battle-logging form opens/closes above it (instead of
 * jumping). While `dimBelow` is set, a site-gray overlay covers the block
 * and makes it inaccessible.
 */
export default function BattleHistoryModules({
  dimBelow,
  children,
}: {
  dimBelow: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      layout
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="relative flex flex-col gap-4"
    >
      {dimBelow && (
        <div className="absolute inset-0 z-20 bg-[#f2f2f2]/80 dark:bg-[#242424]/80" aria-hidden="true" />
      )}
      {children}
    </motion.div>
  );
}
