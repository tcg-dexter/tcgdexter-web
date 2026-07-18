import DisableScrollAnchoring from "@/app/components/DisableScrollAnchoring";

/**
 * Both routes under this segment (the collection index and each deck's
 * detail page) stream behind a `loading.tsx` skeleton that's much shorter
 * than the real content — deck count and match history vary per user —
 * and the view toggle (grid ↔ list) swaps two very-different-height
 * renderings of the same deck list. Both are exactly the trigger
 * DisableScrollAnchoring exists for; see that component for the full
 * root-cause writeup.
 */
export default function MyDecksLayout({
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
