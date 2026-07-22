import { createClient } from "@/lib/supabase/server";
import MobileNavMenu from "./MobileNavMenu";
import MobileToolbarLogo from "./MobileToolbarLogo";
import SiteSidebar from "./SiteSidebar";
import SiteSidebarRight from "./SiteSidebarRight";

/**
 * Site chrome rendered by the root layout on every page.
 *
 * Auth-aware (server component): fetches the user + display name once and
 * passes the payload to the mobile toolbar and the leading-edge sidebar.
 * The trailing-edge sidebar carries only external links and needs no auth
 * context. Responsive visibility is handled by the children:
 *   - MobileNavMenu lives inside an `xl:hidden` toolbar → hidden on xl+.
 *   - SiteSidebar + SiteSidebarRight are `hidden xl:flex` → hidden below xl.
 *
 * Breakpoint sits at `xl` (1280 px) — landscape iPad and small laptops
 * keep the mobile hamburger; larger desktops get the dual-rail layout.
 *
 * Mobile nav UI is intentionally unchanged. Root layout pairs the dual
 * rails with `xl:pl-80 xl:pr-80` on the page wrapper so content sits
 * between them.
 */
export default async function SiteNav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let username: string | null = null;
  let isAdmin = false;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, username, is_admin")
      .eq("id", user.id)
      .single();
    displayName = data?.display_name ?? null;
    username = data?.username ?? null;
    isAdmin = data?.is_admin ?? false;
  }

  // Latest published spotlight slug — drives the nav menu's
  // "Spotlight" link target. Falls back to the index page when no
  // spotlight is published yet (or for any anon-read RLS reason).
  const { data: latestSpotlight } = await supabase
    .from("trainer_spotlights")
    .select("slug")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ slug: string }>();
  const spotlightHref = latestSpotlight?.slug
    ? `/spotlight/${latestSpotlight.slug}`
    : "/spotlight";

  return (
    <>
      {/* Mobile / portrait-tablet: sticky top toolbar.
          Layout: back-button slot on the left, hamburger trigger on the
          right, `MobileToolbarLogo` absolutely centered between them
          (renders only on top-level routes, independent of whether the
          back-slot is occupied). `BackButton` portals its render into
          #mobile-back-slot on small viewports so every back affordance
          shares the row with the menu trigger. The logo is positioned
          to match the logo inside `MobileNavMenu`'s open panel exactly,
          so opening the menu doesn't shift it. */}
      <nav
        data-site-toolbar
        className="xl:hidden sticky top-0 z-30 backdrop-blur-xl bg-bg/70"
      >
        <div className="mx-auto max-w-6xl px-6 h-14 relative flex items-center justify-between">
          <div id="mobile-back-slot" className="flex items-center" />
          <MobileToolbarLogo />
          <MobileNavMenu
            isAuthed={!!user}
            displayName={displayName}
            username={username}
            isAdmin={isAdmin}
            spotlightHref={spotlightHref}
          />
        </div>
      </nav>

      {/* Desktop / landscape-tablet: persistent dual sidebars. */}
      <SiteSidebar
        isAuthed={!!user}
        displayName={displayName}
        username={username}
        isAdmin={isAdmin}
        spotlightHref={spotlightHref}
      />
      <SiteSidebarRight isAdmin={isAdmin} />
    </>
  );
}
