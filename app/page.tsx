/* ─── Link data ─────────────────────────────────────────────── */

const links = [
  {
    title: "Deck Profiler",
    description: "Learn from your deck list",
    href: "/analyze",
    badge: "Beta",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
      </svg>
    ),
  },
  {
    title: "TCG News",
    description: "Stay in the know",
    href: "https://tcgdexter.beehiiv.com/",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    title: "Shop the Collection",
    description: "Fill up your binder",
    href: "https://www.ebay.com/usr/tcgdexter",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a.75.75 0 0 1 .218-.53l7.5-7.5a.75.75 0 0 1 1.064 0l7.5 7.5a.75.75 0 0 1 .218.53" />
      </svg>
    ),
    external: true,
  },
  {
    title: "Watch on TikTok",
    description: "Deck techs, pack rips, and more",
    href: "https://www.tiktok.com/@tcgdexter",
    external: true,
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.71a8.21 8.21 0 0 0 4.76 1.5v-3.4a4.85 4.85 0 0 1-1-.12Z" />
      </svg>
    ),
  },
];

/* ─── Page ──────────────────────────────────────────────────── */

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="flex-shrink-0 pt-20 pb-16 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
          Dexter
        </h1>

        <p className="mt-4 text-lg sm:text-xl text-brown-500 max-w-md mx-auto leading-relaxed">
          Pokémon cards. Competitive insight. Community.
        </p>
      </header>

      {/* ── Links ────────────────────────────────────────────── */}
      <main className="flex-1 px-6 pb-20">
        <div className="mx-auto max-w-lg flex flex-col gap-4">
          {links.map((link) => (
            <a
              key={link.title}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="card-lift group relative flex items-center gap-4 rounded-xl border border-tan-200 bg-tan-100 px-5 py-4 backdrop-blur-sm transition-colors hover:border-energy/30 hover:bg-tan-200"
            >
              {/* Icon */}
              <span className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-tan-50 text-brown-500 group-hover:text-energy transition-colors">
                {link.icon}
              </span>

              {/* Text */}
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-brown-900 text-sm sm:text-base">
                    {link.title}
                  </span>
                  {link.badge && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-energy/10 text-energy border border-energy/20">
                      {link.badge}
                    </span>
                  )}
                </span>
                <span className="block text-sm text-brown-500 mt-0.5 truncate">
                  {link.description}
                </span>
              </span>

              {/* Arrow */}
              <svg
                className="flex-shrink-0 w-4 h-4 text-brown-500 group-hover:text-energy group-hover:translate-x-0.5 transition-all"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </a>
          ))}
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="flex-shrink-0 py-8 px-6 text-center text-sm text-brown-300">
        <p>&copy; 2026 TCG Dexter &middot; tcgdexter.com</p>
        <p className="mt-3 max-w-lg mx-auto text-xs text-brown-300/70 leading-relaxed">
          TCG Dexter is an independent organization. The information presented on this website about the Pokémon Trading Card Game, including images and text, is intellectual property of The Pokémon Company, Nintendo, Game Freak, Creatures and/or Wizards of the Coast. TCG Dexter is not produced by, endorsed by, supported by, or affiliated with any of these companies.
        </p>
      </footer>
    </div>
  );
}
