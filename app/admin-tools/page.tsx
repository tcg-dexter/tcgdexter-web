import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Admin Tools · TCG Dexter",
};

interface Tool {
  href: string;
  title: string;
  description: string;
}

const TOOLS: Tool[] = [
  {
    href: "/admin/spotlight",
    title: "Spotlight Admin",
    description: "Curate Trainer Spotlight features.",
  },
  {
    href: "/admin-tools/social-studio",
    title: "Social Studio",
    description:
      "Browse 9:16 social-ready cards built from published content.",
  },
];

export default async function AdminToolsPage() {
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

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Admin Tools</h1>
        </header>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="block rounded-2xl border border-black/8 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-sm font-semibold text-text-primary">
                  {tool.title}
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {tool.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
