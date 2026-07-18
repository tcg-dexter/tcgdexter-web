import DisableScrollAnchoring from "@/app/components/DisableScrollAnchoring";

/**
 * Both routes under this segment (a trainer's profile — banner, bio, and
 * their saved-deck preview grid — and each deck's own detail page) stream
 * behind loading.tsx, a min-h-dvh centered spinner roughly one viewport
 * tall. Real content (deck count and bio length both vary per user) is
 * typically much taller — the same short-skeleton-behind-tall-content
 * shape that caused the scroll-jump-to-bottom bug on /my-decks. See
 * DisableScrollAnchoring for the full root-cause writeup.
 */
export default function UserProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DisableScrollAnchoring />
      {children}
    </>
  );
}
