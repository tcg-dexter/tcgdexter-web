import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DesignLibraryClient from "./DesignLibraryClient";

export const metadata: Metadata = {
  title: "Design Library · TCG Dexter",
};

export default async function DesignLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  return <DesignLibraryClient />;
}
