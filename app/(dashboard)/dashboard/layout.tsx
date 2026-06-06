import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dexter Dashboard",
  robots: { index: false, follow: false },
};

function adminEmails(): string[] {
  const raw = process.env.DASHBOARD_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allow = adminEmails();
  const email = user?.email?.toLowerCase() ?? null;

  if (!user || !email || (allow.length > 0 && !allow.includes(email))) {
    redirect("/sign-in?next=/dashboard");
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <header className="border-b border-black/8 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Dexter Dashboard</span>
            <span className="text-xs text-[var(--text-muted)]">internal</span>
          </div>
          <nav className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
            <a
              href="https://tcgdexter.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--text-primary)] hover:underline underline-offset-4"
            >
              prod ↗
            </a>
            <a
              href="https://preview.tcgdexter.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--text-primary)] hover:underline underline-offset-4"
            >
              preview ↗
            </a>
            <span className="text-[var(--text-muted)]">·</span>
            <span>{email}</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
