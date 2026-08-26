"use client";

import PillSelect from "@/app/components/ui/PillSelect";

/**
 * Prev/Next + "page N of M" + a per-page count picker. Originally the card
 * catalog's own (unexported) control; shared here so other paginated lists
 * (deck collection) render the identical control instead of a bespoke one.
 */
export default function Pagination({
  page,
  totalPages,
  pageSize,
  pageSizeOptions = [60, 120, 240],
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  /** Options offered in the "Per page" picker. Defaults to the card
   *  catalog's own values; pass a smaller set for a lighter-weight list. */
  pageSizeOptions?: number[];
  onPage: (p: number) => void;
  onPageSize: (ps: number) => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div className="mt-6 flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={!canPrev}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 disabled:opacity-40 hover:bg-surface transition-colors"
        >
          ← Prev
        </button>
        <span className="text-xs text-text-secondary">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={!canNext}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 disabled:opacity-40 hover:bg-surface transition-colors"
        >
          Next →
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span>Per page:</span>
        <PillSelect
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </PillSelect>
      </div>
    </div>
  );
}
