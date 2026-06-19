import { notFound } from "next/navigation";
import {
  getCampaign,
  listCampaignRecipients,
} from "../../lib/queries";
import CampaignDetailClient from "./CampaignDetailClient";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const campaign = await getCampaign(params.id);
  if (!campaign) notFound();

  const recipients = await listCampaignRecipients(params.id);

  return <CampaignDetailClient campaign={campaign} initialRecipients={recipients} />;
}
