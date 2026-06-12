"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface ProfileHit {
  display_name: string;
  username: string;
  avatar_url: string | null;
}

export default function NewSpotlightForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileHit[]>([]);
  const [selected, setSelected] = useState<ProfileHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    setSelected(null);
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_url")
        .eq("is_public", true)
        .not("username", "is", null)
        .or(`username.ilike.${val.toLowerCase()}%,display_name.ilike.${val}%`)
        .order("display_name")
        .limit(8);
      setResults((data as ProfileHit[]) ?? []);
      setSearching(false);
    }, 300);
  }

  function selectProfile(p: ProfileHit) {
    setSelected(p);
    setQuery(p.display_name);
    setResults([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setCreating(true);
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
      setCreating(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search trainers by username or name…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-black/15 bg-white"
        />
        <button
          type="submit"
          disabled={creating || !selected}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-black text-white border border-transparent disabled:opacity-50 whitespace-nowrap"
        >
          {creating ? "Creating…" : "Create draft"}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="rounded-lg border border-black/8 bg-white shadow-sm overflow-hidden divide-y divide-black/5">
          {results.map((p) => (
            <li key={p.username}>
              <button
                type="button"
                onClick={() => selectProfile(p)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-black/[0.03] transition-colors"
              >
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-black/[0.06] flex items-center justify-center flex-shrink-0 text-sm font-semibold text-text-muted">
                    {p.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{p.display_name}</div>
                  <div className="text-xs text-text-muted">@{p.username}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && <p className="text-xs text-text-muted">Searching…</p>}
      {!searching && query.trim() && results.length === 0 && !selected && (
        <p className="text-xs text-text-muted">No trainers found for &ldquo;{query}&rdquo;.</p>
      )}
      {error && <p className="text-xs text-accent">{error}</p>}
    </form>
  );
}
