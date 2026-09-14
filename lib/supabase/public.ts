import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for PUBLIC, non-user-scoped reads on the server.
 *
 * Unlike `./server`, this never touches cookies. That is the whole point:
 * `cookies()` marks a request dynamic and is forbidden inside
 * `unstable_cache`, so a cached loader cannot use the SSR client. Anything
 * read through here must be readable by `anon` under RLS — it carries no user
 * session, so it sees exactly what a signed-out visitor sees.
 *
 * Unlike `./admin`, it does not use the service role and cannot bypass RLS.
 * Prefer this for public reference data; reach for the admin client only when
 * a write or an RLS bypass is genuinely required.
 *
 * Current uses:
 *   - lib/shopListings.ts — the shop_listings table, public-read by policy
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
