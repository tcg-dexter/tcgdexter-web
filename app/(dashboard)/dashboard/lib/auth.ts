import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Shared admin gate for the dashboard subdomain. The layout calls
// requireDashboardAdmin() so every /dashboard/* route is protected, and API
// handlers under /api/admin/* call assertDashboardAdmin() to do the same
// check without a redirect (returns a 401/403 response instead).
//
// The allowlist source is DASHBOARD_ADMIN_EMAILS — a comma-separated list of
// emails set in Vercel envs. If the env var is empty, only the page guard's
// "must be signed in" check applies; the API guard treats an empty list as
// "no one is admin" and returns 403, since an unset list on a service-role
// API is a misconfiguration we'd rather fail closed on.

function adminEmails(): string[] {
  const raw = process.env.DASHBOARD_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireDashboardAdmin(): Promise<{ email: string; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allow = adminEmails();
  const email = user?.email?.toLowerCase() ?? null;

  if (!user || !email || (allow.length > 0 && !allow.includes(email))) {
    redirect("/sign-in?next=/dashboard");
  }

  return { email, userId: user.id };
}

export async function assertDashboardAdmin(): Promise<
  | { ok: true; email: string; userId: string }
  | { ok: false; status: 401 | 403 }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return { ok: false, status: 401 };

  const allow = adminEmails();
  const email = user.email.toLowerCase();
  if (allow.length === 0 || !allow.includes(email)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, email, userId: user.id };
}
