// Shared CRM types. Lives under the dashboard route so it stays out of the
// public marketing app's bundle even when an API client component imports
// it (Next 14 will still tree-shake unused types).

export type CampaignStatus = "draft" | "sending" | "complete";

export type RecipientType = "manual" | "signup_window";

// Recipient rule shape mirrors the columns on email_campaigns. When the
// type is 'manual', the window dates are null and recipients are added
// one at a time. When 'signup_window', the dates bound auth.users.created_at
// and the sync helper auto-enrolls matching users into email_sends.
export type RecipientRule = {
  type: RecipientType;
  signup_window_start: string | null;
  signup_window_end: string | null;
};

export type CrmActiveSend = {
  send_id: string;
  campaign_id: string;
  campaign_name: string;
  sent_at: string | null;
};

export type CrmContact = {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  signup_at: string | null;
  last_sign_in_at: string | null;
  deck_count: number;
  match_count: number;
  // One entry per draft/sending campaign this user is a recipient of.
  // Completed campaigns are intentionally excluded — the contact dashboard
  // is for live communication state. Reorder by something else if you need
  // historical send signals.
  active_sends: CrmActiveSend[];
};

export type CrmCampaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
  recipient_type: RecipientType;
  signup_window_start: string | null;
  signup_window_end: string | null;
  recipient_count: number;
  sent_count: number;
};

export type CrmCampaignRecipient = {
  send_id: string;
  user_id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  sent_at: string | null;
};
