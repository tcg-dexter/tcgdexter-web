"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UnifiedSearch from "@/app/leaderboard/UnifiedSearch";
import {
  BookOpenIcon,
  DiscordIcon,
  GaugeIcon,
  MailIcon,
  TikTokIcon,
  ShoppingBagIcon,
} from "./nav-icons";

interface Props {
  /** Whether the signed-in user has profiles.is_admin. When true, an Admin
   *  section anchored to the bottom of the rail surfaces dashboard tools. */
  isAdmin?: boolean;
}

/**
 * Trailing-edge (right) sidebar — desktop only (xl+, 1280 px).
 *
 * Carries the global search and the external links. Paired with SiteSidebar
 * on the leading edge; both rails are `hidden xl:flex`. Root layout
 * reserves space with `xl:pr-[230px]` on the page wrapper. Landscape iPad
 * and smaller laptops stay on the mobile hamburger.
 *
 * The search occupies the same `h-20` header block that the logo claims on
 * the opposite rail (`pl-3 pr-6` here mirrors the logo's `pl-6 pr-3`), so
 * the two surfaces read as balanced corners of the chrome.
 *
 * Keep the external-link list in sync with MobileNavMenu's EXTERNAL_LINKS.
 */
export default function SiteSidebarRight({ isAdmin = false }: Props) {
  const pathname = usePathname();
  const INTERNAL_LINKS = [
    { href: "/learn", label: "Learn to Play", Icon: BookOpenIcon },
  ];
  const EXTERNAL_LINKS = [
    { href: "https://www.ebay.com/usr/tcgdexter", label: "Card Shop", Icon: ShoppingBagIcon },
    { href: "https://discord.gg/G3VfEzfmJF", label: "Discord", Icon: DiscordIcon },
    { href: "https://www.tiktok.com/@tcgdexter", label: "TikTok", Icon: TikTokIcon },
  ];

  // Admin destinations — only rendered when isAdmin. Dashboard targets the
  // mission-control root; CRM targets the contacts/campaigns section. Both
  // are internal Next routes; on dashboard.tcgdexter.com middleware
  // rewrites them under the dashboard subdomain transparently.
  const ADMIN_LINKS = [
    { href: "/dashboard", label: "Dashboard", Icon: GaugeIcon, exact: true },
    { href: "/dashboard/crm", label: "CRM", Icon: MailIcon, exact: false },
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  // Admin "Dashboard" sits at /dashboard; CRM lives under /dashboard/crm.
  // Without an exact check, the Dashboard row would highlight on every CRM
  // page too — match exactly when the link explicitly opts in.
  const isActiveExact = (href: string, exact: boolean) =>
    exact ? pathname === href : isActive(href);

  // Rows match SiteSidebar's geometry: gap-3 between icon and label,
  // capsule (rounded-full) hover pill, text-base label.
  const linkBase =
    "flex items-center gap-3 px-3 py-2 rounded-full text-base font-medium transition-colors";
  const linkInactive =
    "text-text-secondary hover:text-text-primary hover:bg-surface";
  const linkActive = "text-text-primary bg-surface";
  const externalClass = `${linkBase} ${linkInactive}`;

  return (
    <aside
      aria-label="External links"
      className="hidden xl:flex fixed inset-y-0 right-0 z-30 w-[230px] flex-col bg-bg border-l border-[var(--border)] pt-8"
    >
      {/* Header — same h-20 footprint as the logo block on the left rail.
          `pl-3 pr-6` mirrors the logo's `pl-6 pr-3` so the input's trailing
          edge sits 24 px from the rail border, the same distance the logo's
          leading edge sits from its own rail border. */}
      <div className="flex-shrink-0 h-20 pl-3 pr-6 flex items-center">
        <div className="w-full">
          <UnifiedSearch />
        </div>
      </div>

      <nav className="flex-1 flex flex-col overflow-y-auto px-3 pt-4 pb-6">
        <ul className="flex flex-col gap-0.5">
          {INTERNAL_LINKS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={`${linkBase} ${isActive(href) ? linkActive : linkInactive}`}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            </li>
          ))}
          {EXTERNAL_LINKS.map(({ href, label, Icon }) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={externalClass}
              >
                <Icon />
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ul>

        {/* Admin section — anchored to the bottom of the rail when the
            signed-in user has profiles.is_admin. mt-auto pushes it down
            while the nav flex column keeps the search and external links
            up top. */}
        {isAdmin && (
          <div className="mt-auto pt-4">
            <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Admin
            </div>
            <ul className="flex flex-col gap-0.5">
              {ADMIN_LINKS.map(({ href, label, Icon, exact }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className={`${linkBase} ${isActiveExact(href, exact) ? linkActive : linkInactive}`}
                  >
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </aside>
  );
}
