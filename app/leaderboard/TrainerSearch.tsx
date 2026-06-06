"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface ProfileHit {
  display_name: string;
  username: string;
  avatar_url: string | null;
}

export default function TrainerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
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
      setSearched(true);
      setLoading(false);
    }, 300);
  }

  return (
    <div className="max-w-md w-full mx-auto">
      <div className="relative">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          {loading ? (
            <svg className="w-4 h-4 text-text-muted animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search trainers by username…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full rounded-xl border border-black/10 bg-white pl-10 pr-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-gradient-border [font-size:16px] sm:text-sm"
        />
      </div>

      {searched && results.length === 0 && (
        <p className="mt-3 text-sm text-text-muted text-center">No trainers found for &ldquo;{query}&rdquo;.</p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 rounded-xl border border-black/8 bg-white shadow-sm overflow-hidden divide-y divide-black/5">
          {results.map((p) => (
            <li key={p.username}>
              <Link
                href={`/u/${p.username}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.03] transition-colors"
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
