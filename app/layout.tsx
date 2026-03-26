import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "TCG Dexter | Pokémon TCG",
  description:
    "Pokémon cards. Competitive insight. Community. Shop singles, follow the meta, and profile your deck.",
  openGraph: {
    title: "TCG Dexter | Pokémon TCG",
    description: "Pokémon cards. Competitive insight. Community.",
    url: "https://tcgdexter.com",
    siteName: "TCG Dexter",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TCG Dexter | Pokémon TCG",
    description: "Pokémon cards. Competitive insight. Community.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-tan-50 text-brown-900`}
      >
        {children}
      </body>
    </html>
  );
}
