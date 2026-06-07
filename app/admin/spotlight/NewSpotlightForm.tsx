"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewSpotlightForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/spotlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
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
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username (e.g. dexter)"
        className="flex-1 px-3 py-2 text-sm rounded-lg border border-black/15 bg-white"
        required
      />
      <button
        type="submit"
        disabled={loading || !username}
        className="text-xs font-semibold px-4 py-2 rounded-lg bg-black text-white border border-transparent disabled:opacity-50"
      >
        {loading ? "Creating…" : "Create draft"}
      </button>
      {error && (
        <p className="text-xs text-accent w-full">{error}</p>
      )}
    </form>
  );
}
