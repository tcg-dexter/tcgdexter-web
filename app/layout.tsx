import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers, cookies } from "next/headers";
import "./globals.css";
import ThemeProvider from "./components/ThemeProvider";
import SiteNav from "./components/ui/SiteNav";
import SiteFooter from "./components/ui/SiteFooter";
import GlobalSearchHotkey from "./components/ui/GlobalSearchHotkey";
import StreakToast from "./components/StreakToast";
import NavigationTracker from "./components/ui/NavigationTracker";
import BrandGradientDefs from "./components/BrandGradientDefs";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const DASHBOARD_HOST = "dashboard.tcgdexter.com";

/* Geist Sans — clean, modern typeface from Vercel */
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

/* Geist Mono — for any code/monospace elements */
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "TCG Dexter",
  description:
    "Collect. Compete. Level up.",
  openGraph: {
    title: "TCG Dexter",
    description: "Collect. Compete. Level up.",
    url: "https://tcgdexter.com",
    siteName: "TCG Dexter",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TCG Dexter",
    description: "Collect. Compete. Level up.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Dashboard subdomain is an internal admin surface — strip the marketing
  // site chrome (sidebars, footer, search hotkey) and the sidebar gutter.
  const host = headers().get("host") ?? "";
  const isDashboard = host === DASHBOARD_HOST;

  // Resolved server-side so explicit light/dark renders with zero flash —
  // only "system" needs the client-side script below, since SSR can't
  // know the OS preference.
  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);
  const initialHtmlClass = theme === "dark" ? "dark" : "";

  return (
    <html lang="en" className={initialHtmlClass}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased text-[var(--text-primary)]`}
      >
        {theme === "system" && (
          <script
            // Blocking by design — must run before first paint to avoid a
            // flash of the wrong theme. Only reachable when theme is
            // "system", so it's absent from the response for the (much
            // more common) explicit light/dark cases.
            dangerouslySetInnerHTML={{
              __html:
                "if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}",
            }}
          />
        )}
        <BrandGradientDefs />
        <ThemeProvider initialTheme={theme}>
          {isDashboard ? (
            // overflow-y-visible is deliberate, not a default left in place:
            // per the CSS overflow spec, setting only overflow-x to
            // something other than visible computes the unset overflow-y to
            // auto, not visible — silently turning this full-page div into
            // its own scroll/clip container instead of leaving scrolling to
            // the document. iOS Safari then clips box-shadow/blur content
            // inside it into visible artifacts around scroll-position
            // changes (e.g. the viewport resize when a keyboard opens or
            // closes). Pinning overflow-y keeps overflow-x's actual job —
            // stopping horizontal scroll — without that side effect.
            <div className="min-h-dvh bg-bg text-text-primary antialiased overflow-x-hidden overflow-y-visible">
              {children}
            </div>
          ) : (
            /* `xl:pl-[230px] xl:pr-[230px]` reserves space for the two fixed
                desktop sidebars rendered inside <SiteNav /> (each at 230 px,
                kicking in at 1280 px). Mobile, portrait tablet, and landscape
                iPad / smaller laptops keep the original mobile-nav layout.
                overflow-y-visible: see the comment on the dashboard branch
                above — overflow-x-hidden alone implicitly computes
                overflow-y to auto, which is what was clipping the deck-list
                card's shadow on focus/blur. */
            <div className="min-h-dvh flex flex-col bg-bg text-text-primary antialiased overflow-x-hidden overflow-y-visible xl:pl-[230px] xl:pr-[230px]">
              <NavigationTracker />
              <SiteNav />
              <div className="flex-1">{children}</div>
              <SiteFooter />
              <GlobalSearchHotkey />
              <StreakToast />
            </div>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
