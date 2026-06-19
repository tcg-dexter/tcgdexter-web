import NewCampaignForm from "./NewCampaignForm";

export default function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-sm font-semibold text-[var(--text-secondary)]">
        New campaign
      </h1>
      <NewCampaignForm />
    </div>
  );
}
