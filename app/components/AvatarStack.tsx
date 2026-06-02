"use client";

import { useState } from "react";

export interface AvatarStackItem {
  /** Stable identity for failure tracking. Usually the Pokémon name. */
  key: string;
  iconUrl: string | null;
  iconBg: string | null;
}

interface Props {
  /** Ordered candidate pool. First `count` non-failed entries are shown. */
  items: AvatarStackItem[];
  /** Target number of avatars to render. */
  count: number;
}

/**
 * Renders up to `count` overlapping circular Pokémon avatars from a
 * candidate pool. If a sprite 404s the slot is dropped and the next pool
 * entry takes its place — so heavy callers should pass `count + spare`
 * candidates to absorb missing sprites (the limitless gen9 sprite host
 * doesn't cover every form / regional variant).
 */
export default function AvatarStack({ items, count }: Props) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const visible: AvatarStackItem[] = [];
  for (const item of items) {
    if (visible.length >= count) break;
    if (failed.has(item.key)) continue;
    visible.push(item);
  }
  return (
    <>
      {visible.map((item, i) => (
        <div key={item.key} className={i === 0 ? "" : "-ml-2"}>
          <Avatar
            iconUrl={item.iconUrl}
            iconBg={item.iconBg}
            onFail={() =>
              setFailed((prev) => {
                if (prev.has(item.key)) return prev;
                const next = new Set(prev);
                next.add(item.key);
                return next;
              })
            }
          />
        </div>
      ))}
    </>
  );
}

function Avatar({
  iconUrl,
  iconBg,
  onFail,
}: {
  iconUrl: string | null;
  iconBg: string | null;
  onFail: () => void;
}) {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden ring-2 ring-white"
      style={{ background: iconBg ?? "#B0A89E" }}
      aria-hidden
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          className="w-7 h-7 object-contain"
          onError={onFail}
        />
      ) : null}
    </div>
  );
}
