import { requireDashboardAdmin } from "./lib/auth";
import DashboardNav from "./components/DashboardNav";
import { ExternalLinkPill } from "./components/Card";

export const metadata = {
  title: "Dexter Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requireDashboardAdmin();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <header className="border-b border-black/8 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Dexter Dashboard</span>
              <span className="text-xs text-[var(--text-muted)]">internal</span>
            </div>
            <DashboardNav />
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ExternalLinkPill href="https://tcgdexter.com">prod</ExternalLinkPill>
            <ExternalLinkPill href="https://preview.tcgdexter.com">
              preview
            </ExternalLinkPill>
            {/* Email hidden on very narrow widths — admin already knows who they are */}
            <span className="hidden text-[var(--text-muted)] sm:inline">·</span>
            <span className="hidden truncate max-w-[200px] sm:inline">{email}</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
