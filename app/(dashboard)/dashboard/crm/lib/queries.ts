import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CrmCampaign,
  CrmCampaignRecipient,
  CrmContact,
} from "./types";

// All CRM data queries live here so the API routes and the server-rendered
// dashboard pages can share them. Everything goes through the service-role
// client because (a) we need auth.users for emails + last_sign_in_at and (b)
// the dashboard subdomain is already gated by the DASHBOARD_ADMIN_EMAILS
// allowlist, so there's no per-user RLS to enforce.

// Builds an in-memory counter for "rows per user_id" from a small table.
// Used for deck_count and match_count — both tables are O(hundreds) of rows
// today, so pulling user_id columns and counting in JS is cheaper than
// adding a postgres function and faster to ship.
function tallyByUser(rows: Array<{ user_id: string | null }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.user_id) continue;
    out.set(r.user_id, (out.get(r.user_id) ?? 0) + 1);
  }
  return out;
}

export async function listContacts(): Promise<CrmContact[]> {
  const admin = createAdminClient();

  const [
    { data: profiles, error: profilesErr },
    { data: deckRows, error: decksErr },
    { data: matchRows, error: matchesErr },
    { data: sendRows, error: sendsErr },
    authList,
  ] = await Promise.all([
    admin.from("profiles").select("id, username, display_name"),
    admin.from("saved_decks").select("user_id"),
    admin.from("matches").select("user_id"),
    admin
      .from("email_sends")
      .select("recipient_user_id, sent_at, campaign_id, email_campaigns(name)")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesErr) throw profilesErr;
  if (decksErr) throw decksErr;
  if (matchesErr) throw matchesErr;
  if (sendsErr) throw sendsErr;
  if (authList.error) throw authList.error;

  const deckCount = tallyByUser((deckRows ?? []) as Array<{ user_id: string | null }>);
  const matchCount = tallyByUser((matchRows ?? []) as Array<{ user_id: string | null }>);

  // Sends were ordered DESC by sent_at, so the first hit per user is the latest.
  const lastSendByUser = new Map<string, CrmContact["last_send"]>();
  type SendRow = {
    recipient_user_id: string;
    sent_at: string;
    campaign_id: string;
    email_campaigns: { name: string } | { name: string }[] | null;
  };
  for (const r of (sendRows ?? []) as SendRow[]) {
    if (lastSendByUser.has(r.recipient_user_id)) continue;
    // PostgREST returns the joined row as an object or single-element array
    // depending on the relationship cardinality — normalize.
    const camp = Array.isArray(r.email_campaigns)
      ? r.email_campaigns[0]
      : r.email_campaigns;
    lastSendByUser.set(r.recipient_user_id, {
      campaign_id: r.campaign_id,
      campaign_name: camp?.name ?? "(untitled)",
      sent_at: r.sent_at,
    });
  }

  const authById = new Map(
    authList.data.users.map((u) => [u.id, u] as const)
  );

  const contacts: CrmContact[] = (profiles ?? [])
    .map((p) => {
      const u = authById.get(p.id);
      if (!u || !u.email) return null;
      return {
        id: p.id,
        email: u.email,
        username: p.username ?? null,
        display_name: p.display_name ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        deck_count: deckCount.get(p.id) ?? 0,
        match_count: matchCount.get(p.id) ?? 0,
        last_send: lastSendByUser.get(p.id) ?? null,
      } satisfies CrmContact;
    })
    .filter((c): c is CrmContact => c !== null);

  return contacts;
}

export async function listCampaigns(): Promise<CrmCampaign[]> {
  const admin = createAdminClient();

  const [campRes, sendsRes] = await Promise.all([
    admin
      .from("email_campaigns")
      .select("id, name, subject, body, status, created_at, completed_at, created_by")
      .order("created_at", { ascending: false }),
    admin.from("email_sends").select("campaign_id, sent_at"),
  ]);

  if (campRes.error) throw campRes.error;
  if (sendsRes.error) throw sendsRes.error;

  const recipientCount = new Map<string, number>();
  const sentCount = new Map<string, number>();
  for (const r of (sendsRes.data ?? []) as Array<{
    campaign_id: string;
    sent_at: string | null;
  }>) {
    recipientCount.set(r.campaign_id, (recipientCount.get(r.campaign_id) ?? 0) + 1);
    if (r.sent_at) sentCount.set(r.campaign_id, (sentCount.get(r.campaign_id) ?? 0) + 1);
  }

  return (campRes.data ?? []).map((c) => ({
    ...c,
    recipient_count: recipientCount.get(c.id) ?? 0,
    sent_count: sentCount.get(c.id) ?? 0,
  })) as CrmCampaign[];
}

export async function getCampaign(id: string): Promise<CrmCampaign | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_campaigns")
    .select("id, name, subject, body, status, created_at, completed_at, created_by")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: sendRows, error: sendsErr } = await admin
    .from("email_sends")
    .select("sent_at")
    .eq("campaign_id", id);
  if (sendsErr) throw sendsErr;

  const recipient_count = sendRows?.length ?? 0;
  const sent_count = (sendRows ?? []).filter((r) => r.sent_at !== null).length;
  return { ...data, recipient_count, sent_count } as CrmCampaign;
}

export async function listCampaignRecipients(
  campaignId: string,
): Promise<CrmCampaignRecipient[]> {
  const admin = createAdminClient();

  const { data: sends, error } = await admin
    .from("email_sends")
    .select("id, recipient_user_id, sent_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!sends || sends.length === 0) return [];

  const userIds = sends.map((s) => s.recipient_user_id);
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .in("id", userIds);
  if (profErr) throw profErr;

  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p] as const),
  );

  const authList = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authList.error) throw authList.error;
  const authById = new Map(authList.data.users.map((u) => [u.id, u] as const));

  return sends.map((s) => {
    const p = profileById.get(s.recipient_user_id);
    const u = authById.get(s.recipient_user_id);
    return {
      send_id: s.id,
      user_id: s.recipient_user_id,
      email: u?.email ?? "",
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      sent_at: s.sent_at,
    } satisfies CrmCampaignRecipient;
  });
}
