import { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCardById, type CardIndexEntry } from "@/lib/cardsIndex";
import ListDetailClient from "./ListDetailClient";

interface ListRecord {
  id: string;
  short_id: string;
  name: string;
  is_public: boolean;
  user_id: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; shortId: string }>;
}): Promise<Metadata> {
  const { username, shortId } = await params;
  const supabase = await createClient();
  const { data: owner } = await supabase
    .from("profiles")
    .select("id, display_name, username, is_public")
    .eq("username", username.toLowerCase())
    .eq("is_public", true)
    .maybeSingle();
  if (!owner) return { title: "List Not Found — TCG Dexter" };
  const { data: list } = await supabase
    .from("lists")
    .select("name")
    .eq("short_id", shortId)
    .eq("user_id", owner.id)
    .eq("is_public", true)
    .maybeSingle();
  if (!list) return { title: "List Not Found — TCG Dexter" };

  const title = `${list.name} by @${owner.username} — TCG Dexter`;
  const description = `${list.name} — a public card list shared by ${owner.display_name}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ username: string; shortId: string }>;
}) {
  const { username, shortId } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, username, is_public")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (!profile) notFound();

  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const isOwner = viewer?.id === profile.id;

  if (!isOwner && !profile.is_public) notFound();

  const { data: listRaw } = isOwner
    ? await supabase
        .from("lists")
        .select("id, short_id, name, is_public, user_id")
        .eq("short_id", shortId)
        .eq("user_id", profile.id)
        .maybeSingle()
    : await supabase
        .from("lists")
        .select("id, short_id, name, is_public, user_id")
        .eq("short_id", shortId)
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .maybeSingle();
  if (!listRaw) notFound();
  const list = listRaw as ListRecord;

  const { data: itemRows } = await supabase
    .from("list_items")
    .select("set_id, number")
    .eq("list_id", list.id)
    .order("created_at", { ascending: true });

  const cards: CardIndexEntry[] = (
    (itemRows ?? []) as Array<{ set_id: string; number: string }>
  )
    .map((i) => getCardById(`${i.set_id}-${i.number}`))
    .filter((c): c is CardIndexEntry => c !== null);

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "tcgdexter.com";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const canonicalShareUrl = `${proto}://${host}/u/${profile.username}/lists/${list.short_id}`;

  return (
    <ListDetailClient
      isOwner={isOwner}
      username={profile.username}
      listId={list.id}
      initialName={list.name}
      initialIsPublic={list.is_public}
      cards={cards}
      canonicalShareUrl={canonicalShareUrl}
    />
  );
}
