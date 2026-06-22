"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Mission control" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/crm", label: "CRM" },
] as const;

export default function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 text-xs">
      {TABS.map((tab) => {
        const active =
          tab.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-2 py-1 transition ${
              active
                ? "bg-[var(--surface)] text-[var(--text-primary)] font-semibold"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
