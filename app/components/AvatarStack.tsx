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
  /**
   * When true, drop the circle background + ring and render the raw sprites
   * side-by-side with a small gap (with a soft drop shadow). Default false.
   */
  bare?: boolean;
}

/**
 * Renders up to `count` Pokémon avatars from a candidate pool. Default
 * mode overlaps circular avatars; `bare` mode renders the raw sprites
 * side-by-side. If a sprite 404s the slot is dropped and the next pool
 * entry takes its place — so heavy callers should pass `count + spare`
 * candidates to absorb missing sprites (the limitless gen9 sprite host
 * doesn't cover every form / regional variant).
 */
export default function AvatarStack({ items, count, bare = false }: Props) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const visible: AvatarStackItem[] = [];
  for (const item of items) {
    if (visible.length >= count) break;
    if (failed.has(item.key)) continue;
    visible.push(item);
  }
  const spacingCls = bare ? "ml-1" : "-ml-2";
  return (
    <>
      {visible.map((item, i) => (
        <div key={item.key} className={i === 0 ? "" : spacingCls}>
          <Avatar
            iconUrl={item.iconUrl}
            iconBg={item.iconBg}
            bare={bare}
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
  bare,
  onFail,
}: {
  iconUrl: string | null;
  iconBg: string | null;
  bare: boolean;
  onFail: () => void;
}) {
  if (bare) {
    if (!iconUrl) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        className="w-10 h-10 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
        onError={onFail}
      />
    );
  }
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
