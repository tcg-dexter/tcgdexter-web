"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface UserResult {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export default function NewSpotlightForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search profiles whenever the query changes (debounced 250ms).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const val = query.trim();
    if (val.length < 2 || selected) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("is_public", true)
        .not("username", "is", null)
        .or(`username.ilike.${val.toLowerCase()}%,display_name.ilike.${val}%`)
        .order("display_name")
        .limit(8);
      setResults((data ?? []) as UserResult[]);
      setSearching(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(user: UserResult) {
    setSelected(user);
    setQuery(user.display_name);
    setOpen(false);
  }

  function clear() {
    setSelected(null);
    setQuery("");
    setResults([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/spotlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: selected.username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      router.push(`/admin/spotlight/${json.id}/edit`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div ref={containerRef} className="relative flex-1">
          {selected ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/15 dark:border-white/10 bg-white dark:bg-surface-2">
              <Avatar user={selected} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text-primary truncate">
                  {selected.display_name}
                </div>
                <div className="text-xs text-text-muted truncate">
                  @{selected.username}
                </div>
              </div>
              <button
                type="button"
                onClick={clear}
                className="text-xs text-text-muted hover:text-accent shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search users by name or @username…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-black/15 dark:border-white/10 bg-white dark:bg-surface-2"
                autoComplete="off"
              />
              {open && query.trim().length >= 2 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border border-black/15 dark:border-white/10 bg-white dark:bg-surface-elevated shadow-lg max-h-72 overflow-y-auto">
                  {searching ? (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      Searching…
                    </div>
                  ) : results.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      No public users match &ldquo;{query}&rdquo;.
                    </div>
                  ) : (
                    <ul>
                      {results.map((u) => (
                        <li key={u.username}>
                          <button
                            type="button"
                            onClick={() => pick(u)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--surface)] text-left"
                          >
                            <Avatar user={u} />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-text-primary truncate">
                                {u.display_name}
                              </div>
                              <div className="text-xs text-text-muted truncate">
                                @{u.username}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || !selected}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-black dark:bg-white text-white dark:text-black border border-transparent disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create draft"}
        </button>
      </div>
      {error && <p className="text-xs text-accent">{error}</p>}
    </form>
  );
}

function Avatar({ user }: { user: UserResult }) {
  if (user.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={user.avatar_url}
        alt={user.display_name}
        className="w-8 h-8 rounded-full object-cover border border-black/8 dark:border-white/10 shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[var(--surface)] flex items-center justify-center text-sm font-semibold text-text-secondary shrink-0">
      {user.display_name.charAt(0).toUpperCase()}
    </div>
  );
}
