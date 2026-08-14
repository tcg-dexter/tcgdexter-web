import { createAdminClient } from "@/lib/supabase/admin";
import type { PartnerPriority, PartnerProspect } from "./types";

// All Partnerships data queries live here so the API routes and the
// server-rendered dashboard page can share them — same split as
// app/(dashboard)/dashboard/crm/lib/queries.ts. Goes through the
// service-role client because the dashboard subdomain is already gated by
// the DASHBOARD_ADMIN_EMAILS allowlist, so there's no per-user RLS to
// enforce (partner_prospects has RLS off entirely, like email_campaigns).

// Client-side sort order, applied after the DB query — priority isn't a
// naturally-orderable Postgres type without a CASE expression, and this
// table is small enough (dozens of rows) that sorting in JS is simpler
// than adding one.
const PRIORITY_RANK: Record<PartnerPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export async function listPartners(): Promise<PartnerProspect[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("partner_prospects")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as PartnerProspect[];
  rows.sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name),
  );
  return rows;
}
