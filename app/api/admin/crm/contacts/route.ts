import { NextResponse } from "next/server";
import { assertDashboardAdmin } from "@/app/(dashboard)/dashboard/lib/auth";
import { listContacts } from "@/app/(dashboard)/dashboard/crm/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await assertDashboardAdmin();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const contacts = await listContacts();
  return NextResponse.json({ contacts });
}
