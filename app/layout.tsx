import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import ThemeProvider from "./components/ThemeProvider";
import SiteNav from "./components/ui/SiteNav";
import SiteFooter from "./components/ui/SiteFooter";
import GlobalSearchHotkey from "./components/ui/GlobalSearchHotkey";
import NavigationTracker from "./components/ui/NavigationTracker";

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
    description: "Pokémon cards. Competitive insight. Community.",
    url: "https://tcgdexter.com",
    siteName: "TCG Dexter",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TCG Dexter",
    description: "Pokémon cards. Competitive insight. Community.",
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

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased text-[var(--text-primary)]`}
      >
        <ThemeProvider>
          {isDashboard ? (
            <div className="min-h-dvh bg-bg text-text-primary antialiased overflow-x-hidden">
              {children}
            </div>
          ) : (
            /* `xl:pl-[230px] xl:pr-[230px]` reserves space for the two fixed
                desktop sidebars rendered inside <SiteNav /> (each at 230 px,
                kicking in at 1280 px). Mobile, portrait tablet, and landscape
                iPad / smaller laptops keep the original mobile-nav layout. */
            <div className="min-h-dvh bg-bg text-text-primary antialiased overflow-x-hidden xl:pl-[230px] xl:pr-[230px]">
              <NavigationTracker />
              <SiteNav />
              {children}
              <SiteFooter />
              <GlobalSearchHotkey />
            </div>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
