import { listCampaigns, listContacts } from "./lib/queries";
import CampaignsModule from "./components/CampaignsModule";
import CrmContactsClient from "./CrmContactsClient";

export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function CrmPage() {
  const [contacts, campaigns] = await Promise.all([
    listContacts(),
    listCampaigns(),
  ]);

  // Targets for the "Add to campaign" action — only non-complete campaigns
  // make sense; once a campaign is marked complete, you create a new one.
  const targets = campaigns.filter((c) => c.status !== "complete");

  const activeCampaigns = campaigns.filter((c) => c.status !== "complete").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Communications · {todayLabel()}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          {greeting()}.
        </h1>
        <p className="mt-1 max-w-prose text-xs text-[var(--text-secondary)] sm:text-sm">
          {contacts.length} signed-up user{contacts.length === 1 ? "" : "s"}
          {activeCampaigns > 0
            ? `, ${activeCampaigns} active campaign${activeCampaigns === 1 ? "" : "s"}`
            : ""}
          . Plan, track, and mark sent — all in one place.
        </p>
      </header>

      <CampaignsModule campaigns={campaigns} />
      <CrmContactsClient contacts={contacts} campaignTargets={targets} />
    </div>
  );
}
