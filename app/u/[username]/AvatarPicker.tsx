"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pokemonSlug } from "@/lib/primaryCardImage";
import { normalizeForSearch } from "@/lib/searchNormalize";
import AnimatedGradient from "@/app/components/AnimatedGradient";

interface Props {
  avatarUrl: string | null;
  gradient: string;
}

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";
const RESULT_LIMIT = 60;

function spriteUrl(name: string): string {
  return `${SPRITE_BASE}/${pokemonSlug(name)}.png`;
}

/**
 * Owner-editable profile avatar — a Pokémon sprite (mirrors the meta
 * archetype header's icon), not an uploaded photo or name monogram.
 * Empty state shows a "+" button; clicking it (or an already-set avatar,
 * to change it) opens a search popover backed by /pokemon-names.json,
 * same pattern as the admin spotlight editor's PokemonNamePicker. Picks
 * persist by PATCHing `avatar_url` on /api/profile with the resolved
 * sprite CDN URL, so every other surface that already renders avatar_url
 * (leaderboard, spotlight, deck OG images) picks it up for free.
 */
export default function AvatarPicker({ avatarUrl, gradient }: Props) {
  const [current, setCurrent] = useState(avatarUrl);
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function ensureNames() {
    if (names) return;
    try {
      const res = await fetch("/pokemon-names.json", { cache: "force-cache" });
      if (res.ok) setNames((await res.json()) as string[]);
    } catch {
      // Network failure — popover just shows an empty result list.
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length > 0) ensureNames();
  }

  async function save(next: string | null) {
    setSaving(true);
    const previous = current;
    setCurrent(next);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: next }),
      });
      if (!res.ok) {
        setCurrent(previous);
        return;
      }
      router.refresh();
    } catch {
      setCurrent(previous);
    } finally {
      setSaving(false);
    }
  }

  function pick(name: string) {
    setOpen(false);
    setQuery("");
    void save(spriteUrl(name));
  }

  function remove() {
    setOpen(false);
    setQuery("");
    void save(null);
  }

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed || !names) return [];
    const q = normalizeForSearch(trimmed);
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const n of names) {
      const lower = normalizeForSearch(n);
      if (lower.startsWith(q)) prefix.push(n);
      else if (lower.includes(q)) sub.push(n);
      if (prefix.length + sub.length >= RESULT_LIMIT * 2) break;
    }
    return [...prefix, ...sub].slice(0, RESULT_LIMIT);
  }, [names, trimmed]);

  return (
    <div ref={containerRef} className="relative z-10 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={current ? "Change avatar" : "Add avatar"}
        disabled={saving}
        className="relative rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0 disabled:opacity-70"
        style={{ width: "115px", height: "115px" }}
      >
        <AnimatedGradient gradient={gradient} className="absolute inset-0" />
        <span className="relative">
          {current ? (
            // Sprite sized to ~78% of the 115px circle so a ring of the
            // avatar-bg gradient shows around the art, matching the meta
            // archetype header's icon treatment.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="" className="w-[90px] h-[90px] object-contain" />
          ) : (
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
            </svg>
          )}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pick an avatar"
          className="absolute left-0 top-full mt-3 z-30 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-black/8 dark:border-white/10 bg-white/95 dark:bg-surface-elevated backdrop-blur-xl shadow-xl p-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search Pokémon…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30 [font-size:16px] sm:text-sm"
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {trimmed && !names ? (
              <p className="text-xs text-text-muted px-2 py-3">Loading…</p>
            ) : !trimmed ? (
              <p className="text-xs text-text-muted px-2 py-3">Start typing to search.</p>
            ) : results.length === 0 ? (
              <p className="text-xs text-text-muted px-2 py-3">No matches.</p>
            ) : (
              <ul className="grid grid-cols-1">
                {results.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => pick(n)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg transition-colors"
                    >
                      <SpriteImg name={n} size={28} />
                      <span className="text-sm text-text-primary truncate">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {current && (
            <button
              type="button"
              onClick={remove}
              className="mt-2 w-full px-2 py-1.5 text-xs font-semibold text-text-muted hover:text-accent transition-colors"
            >
              Remove avatar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SpriteImg({ name, size }: { name: string; size: number }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-surface text-text-secondary font-semibold"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        aria-hidden="true"
      >
        {name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={spriteUrl(name)}
      alt=""
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  );
}
