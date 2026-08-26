import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { track } from "@/lib/analytics/track";
import { BANNER_ACCENT_KEYS } from "@/app/u/[username]/UserProfileHeader";

/**
 * Auth callback — handles the redirect from OAuth providers and magic-link emails.
 *
 * Supports two URL shapes:
 *
 *   1. PKCE code flow (Google/Discord OAuth):
 *      ?code=...&next=/...
 *      → exchangeCodeForSession(code) — needs the client-set code_verifier cookie.
 *
 *   2. Token-hash flow (magic-link emails):
 *      ?token_hash=...&type=email&next=/...
 *      → verifyOtp({ type, token_hash }) — does NOT need code_verifier.
 *
 * Magic links use the token-hash flow so they survive email-provider
 * pre-fetch scanners and cross-device opens (a known Supabase + PKCE issue
 * where the code_verifier cookie is missing because the link was opened in
 * a different browser, or the link was consumed by a safe-link scanner
 * before the user clicked it).
 *
 * For magic links to take this path, the Supabase email template must
 * generate the link as:
 *   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/profile";

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base = isLocalEnv
    ? origin
    : forwardedHost
    ? `https://${forwardedHost}`
    : origin;
  const redirectUrl = `${base}${next}`;

  // Build the redirect response BEFORE the auth call so the Supabase client
  // can write session cookies directly onto it. Using next/headers cookies()
  // here doesn't work — those cookies land on an internal store that is
  // never copied onto the NextResponse we return.
  const response = NextResponse.redirect(redirectUrl);

  // ── Debug logging (remove once magic-link issue is confirmed resolved) ──
  const incomingCookieNames = request.cookies.getAll().map((c) => c.name);
  const cookiesWritten: string[] = [];
  // ────────────────────────────────────────────────────────────────────────

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
            cookiesWritten.push(name);
          });
        },
      },
    }
  );

  let error: { name?: string; message: string } | null = null;
  let flow: "code" | "token_hash" | "none" = "none";

  if (tokenHash && type) {
    flow = "token_hash";
    const result = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    error = result.error;
  } else if (code) {
    flow = "code";
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
  }

  // Single-line log so Vercel doesn't drop subsequent console.log entries.
  console.log(
    `[auth/callback] flow=${flow} host=${forwardedHost} cookies_in=[${incomingCookieNames.join(",")}] cookies_out=[${cookiesWritten.join(",")}] err=${error ? `${error.name ?? "?"}:${error.message}` : "null"}`
  );

  if (flow !== "none" && !error) {
    // Ensure a profiles row exists. There is no DB trigger on auth.users,
    // so OAuth sign-ins won't have a row yet. ignoreDuplicates is a no-op
    // for returning users.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Random default banner color for a brand-new row — with
      // ignoreDuplicates this is an ON CONFLICT DO NOTHING, so
      // banner_accent only ever takes effect on the actual first insert
      // and never touches a returning user's existing choice.
      const randomAccent =
        BANNER_ACCENT_KEYS[Math.floor(Math.random() * BANNER_ACCENT_KEYS.length)];
      await supabase
        .from("profiles")
        .upsert(
          { id: user.id, banner_accent: randomAccent },
          { onConflict: "id", ignoreDuplicates: true },
        );

      // Was this a brand-new signup or a returning sign-in? Read the row
      // age — a created_at within 5 seconds of now is a brand-new user.
      // This is the only place we can cleanly distinguish the two server-
      // side without a separate auth.users trigger.
      const { data: profile } = await supabase
        .from("profiles")
        .select("created_at, username")
        .eq("id", user.id)
        .maybeSingle();
      const isSignup =
        !!profile?.created_at &&
        Date.now() - new Date(profile.created_at).getTime() < 5_000;

      void track(request, isSignup ? "auth.signed_up" : "auth.signed_in", {
        flow,
        provider: type ? "email" : "oauth",
      });

      // Onboarding gate: any signed-in user without a username goes to the
      // welcome page to set one (first-time users, and anyone who abandoned
      // onboarding earlier). Overriding the Location header keeps the session
      // cookies already written onto `response`.
      if (!profile?.username) {
        response.headers.set("location", `${base}/welcome`);
      }
    }

    return response;
  }

  // Either no auth params present, or the auth call returned an error.
  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`);
}
