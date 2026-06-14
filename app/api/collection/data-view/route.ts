import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeCollectionDataViewStats } from "@/lib/collection-stats";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const stats = await computeCollectionDataViewStats(supabase, user.id);
  return NextResponse.json(stats);
}
