import { listCampaigns, listContacts } from "./lib/queries";
import CrmContactsClient from "./CrmContactsClient";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const [contacts, campaigns] = await Promise.all([
    listContacts(),
    listCampaigns(),
  ]);

  // Targets for the "Add to campaign" action — only non-complete campaigns
  // make sense; once a campaign is marked complete, you create a new one.
  const targets = campaigns.filter((c) => c.status !== "complete");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-sm font-semibold text-[var(--text-secondary)]">
          Contacts
        </h1>
        <span className="text-[11px] text-[var(--text-muted)]">
          {contacts.length} signed-up user{contacts.length === 1 ? "" : "s"}
        </span>
      </div>
      <CrmContactsClient contacts={contacts} campaignTargets={targets} />
    </div>
  );
}
