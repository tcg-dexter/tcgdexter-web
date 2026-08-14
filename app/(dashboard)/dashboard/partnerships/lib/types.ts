// Shared Partnerships types. Lives under the dashboard route for the same
// reason app/(dashboard)/dashboard/crm/lib/types.ts does — kept out of the
// public marketing app's bundle even when an API client component imports it.

export type PartnerKind = "creator" | "site" | "podcast" | "newsletter";
export type PartnerTier = "macro" | "mid" | "micro";
export type PartnerPriority = "high" | "medium" | "low";
export type PartnerStatus =
  | "prospect"
  | "contacted"
  | "replied"
  | "partnered"
  | "declined";

// Mirrors the migration's CHECK constraints — kept here so both API routes
// (POST create, PATCH update) validate against the same source of truth.
export const PARTNER_KINDS: PartnerKind[] = ["creator", "site", "podcast", "newsletter"];
export const PARTNER_TIERS: PartnerTier[] = ["macro", "mid", "micro"];
export const PARTNER_PRIORITIES: PartnerPriority[] = ["high", "medium", "low"];
export const PARTNER_STATUSES: PartnerStatus[] = [
  "prospect",
  "contacted",
  "replied",
  "partnered",
  "declined",
];

export type PartnerProspect = {
  id: string;
  name: string;
  handle: string | null;
  kind: PartnerKind;
  tier: PartnerTier | null;
  priority: PartnerPriority;
  status: PartnerStatus;
  note: string;
  reach_note: string | null;
  source_url: string | null;
  // True once a human has confirmed the links below actually resolve —
  // every seeded row starts false. See the migration/seed header comments
  // for why nothing here is treated as verified by default.
  links_verified: boolean;
  youtube_url: string | null;
  twitch_url: string | null;
  tiktok_url: string | null;
  x_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
};
