// Shared CRM types. Lives under the dashboard route so it stays out of the
// public marketing app's bundle even when an API client component imports
// it (Next 14 will still tree-shake unused types).

export type CampaignStatus = "draft" | "sending" | "complete";

export type CrmContact = {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  last_sign_in_at: string | null;
  deck_count: number;
  match_count: number;
  last_send: {
    campaign_id: string;
    campaign_name: string;
    sent_at: string;
  } | null;
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
