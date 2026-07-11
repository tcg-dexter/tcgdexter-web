import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/ml/runs?limit=50&run_type=export
 *
 * Admin-only. Returns recent dexter-ml run telemetry from ml_runs. The
 * table is RLS-enabled with no policies (service-role only by design), so
 * after the admin gate the read goes through the service-role client.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RUN_TYPES = new Set(["export", "train", "eval", "promote"]);

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const runType = url.searchParams.get("run_type");

  const admin = createAdminClient();
  let query = admin
    .from("ml_runs")
    .select("*")
    .order("inserted_at", { ascending: false })
    .limit(limit);
  if (runType && RUN_TYPES.has(runType)) {
    query = query.eq("run_type", runType);
  }

  const { data: runs, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: runs ?? [] });
}
