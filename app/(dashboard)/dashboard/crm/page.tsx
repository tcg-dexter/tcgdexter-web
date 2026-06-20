import { listCampaigns, listContacts } from "./lib/queries";
import CampaignsModule from "./components/CampaignsModule";
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
    <div className="flex flex-col gap-5">
      <CampaignsModule campaigns={campaigns} />
      <CrmContactsClient contacts={contacts} campaignTargets={targets} />
    </div>
  );
}
