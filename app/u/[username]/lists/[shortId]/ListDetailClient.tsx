"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import BackButton from "@/app/components/ui/BackButton";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import GridDensityMenu, { type GridColumns } from "@/app/components/ui/GridDensityMenu";
import InventoryProvider, { useInventory } from "@/app/cards/InventoryContext";
import {
  OwnershipRadios,
  FacetGroup,
  SetFacet,
  RangeFacet,
  VariantFilteredView,
} from "@/app/cards/FilterControls";
import AddSelectionToListDialog from "@/app/cards/AddSelectionToListDialog";
import ShareQRModal from "@/app/components/ShareQRModal";
import ListDetails from "./ListDetails";
import { variantDisplayLabel } from "@/lib/inventory";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import {
  sortCardEntries,
  filterCardEntries,
  computeFacetsFromCards,
  type SortKey,
  type SortDir,
  type OwnershipFilter,
} from "@/lib/cardSearch";

interface Props {
  isOwner: boolean;
  username: string;
  listId: string;
  initialName: string;
  initialIsPublic: boolean;
  cards: CardIndexEntry[];
  canonicalShareUrl: string;
}

interface FilterState {
  q: string;
  supertype: string[];
  type: string[];
  regulation: string[];
  setId: string[];
  hpMin?: number;
  hpMax?: number;
  priceMin?: number;
  priceMax?: number;
  rarity: string[];
  retreatCost: number[];
  ownership: OwnershipFilter;
  variant: string[];
}

const EMPTY_FILTERS: FilterState = {
  q: "",
  supertype: [],
  type: [],
  regulation: [],
  setId: [],
  rarity: [],
  retreatCost: [],
  ownership: "all",
  variant: [],
};

export default function ListDetailClient(props: Props) {
  return (
    <InventoryProvider>
      <ListDetailBody {...props} />
    </InventoryProvider>
  );
}

// useInventory() must be called from a component rendered *inside*
// InventoryProvider — split out from ListDetailClient the same way
// CardsClient.tsx splits into CardsClient + CatalogBody.
function ListDetailBody({
  isOwner,
  username,
  listId,
  initialName,
  initialIsPublic,
  cards: initialCards,
  canonicalShareUrl,
}: Props) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [name, setName] = useState(initialName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [sort, setSort] = useState<SortKey>("released");
  const [dir, setDir] = useState<SortDir>("desc");
  const [view, setView] = useState<"grid" | "list">("grid");
  // Cards-per-row for the grid. `undefined` = GridView's responsive default,
  // which is also the server-rendered state: the stored preference is read in
  // an effect after mount so the first client render matches the HTML and
  // hydration stays clean.
  const [columns, setColumns] = useState<GridColumns | undefined>(undefined);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialName);
  const [renameBusy, setRenameBusy] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmingMakePublic, setConfirmingMakePublic] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    function compute() {
      const btn = menuButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [menuOpen]);

  // Grid density is remembered per list (not per user, not in the DB) — a
  // 60-card binder list and a 400-card wishlist want different densities.
  // Storage can throw in private-browsing modes, so both sides are guarded.
  const columnsStorageKey = `dx_list_cols_${listId}`;

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(columnsStorageKey));
      if (Number.isInteger(stored) && stored >= 2 && stored <= 6) {
        setColumns(stored as GridColumns);
      }
    } catch {
      /* storage unavailable — fall back to the responsive default */
    }
  }, [columnsStorageKey]);

  function chooseColumns(next: GridColumns) {
    setColumns(next);
    try {
      window.localStorage.setItem(columnsStorageKey, String(next));
    } catch {
      /* preference just won't survive a reload */
    }
  }

  // Variant facet options come from the collection itself (same convention
  // as CardsClient.tsx's CatalogBody) — the printing grammar is open-ended,
  // so there's no fixed list to enumerate.
  const { ownedVariants, collection } = useInventory();
  const ownedVariantLabels = useMemo(
    () => Array.from(new Set(ownedVariants.map(variantDisplayLabel))),
    [ownedVariants],
  );

  // The ownership radios need the actual inventory: cardSearch resolves
  // "owned" as `ownedKeys.has(card.id)`, so without this set "Owned" matches
  // nothing and "Unowned" matches everything. `collection` is keyed
  // `${setId}::${number}` (see cardKey in InventoryContext) while card ids are
  // `${setId}-${number}`, hence the rekey. Memoizing on `collection` — rather
  // than caching outside React — is what makes the view re-filter when the
  // async inventory fetch lands instead of freezing on the empty first pass.
  const ownedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, variants] of Object.entries(collection)) {
      const total = Object.values(variants).reduce<number>((n, q) => n + (q ?? 0), 0);
      if (total <= 0) continue;
      const sep = key.indexOf("::");
      if (sep === -1) continue;
      keys.add(`${key.slice(0, sep)}-${key.slice(sep + 2)}`);
    }
    return keys;
  }, [collection]);

  const facets = useMemo(() => computeFacetsFromCards(cards), [cards]);
  const filteredCards = useMemo(
    () => filterCardEntries(cards, { ...filters, ownedKeys }),
    [cards, filters, ownedKeys],
  );
  const sortedCards = useMemo(
    () => sortCardEntries(filteredCards, sort, dir),
    [filteredCards, sort, dir],
  );

  // Multi-select (id -> card, insertion order = selection order) feeding the
  // bulk "Add to list" dialog.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, CardIndexEntry>>(new Map());
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const selectedOrder = useMemo(() => {
    const m = new Map<string, number>();
    Array.from(selected.keys()).forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [selected]);

  function toggleSelect(card: CardIndexEntry) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.set(card.id, card);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Map());
  }

  // Removes the current selection from THIS list (unlike Add, there's no
  // target-list picker — the list being viewed is the only target). Each
  // DELETE is independent/idempotent, so a partial failure just leaves the
  // failed cards in place rather than rolling back the whole batch.
  // Only reached via the confirmation dialog — removal is destructive and
  // there's no undo.
  async function handleRemoveSelected() {
    if (selected.size === 0 || removing) return;
    setRemoving(true);
    const toRemove = Array.from(selected.values());
    try {
      const results = await Promise.all(
        toRemove.map(async (c) => {
          try {
            const res = await fetch(
              `/api/lists/${listId}/items?setId=${encodeURIComponent(c.setId)}&number=${encodeURIComponent(c.number)}`,
              { method: "DELETE" },
            );
            return res.ok ? c.id : null;
          } catch {
            return null;
          }
        }),
      );
      const removedIds = new Set(results.filter((id): id is string => id !== null));
      if (removedIds.size > 0) {
        setCards((prev) => prev.filter((c) => !removedIds.has(c.id)));
      }
      exitSelectMode();
    } finally {
      setRemoving(false);
      setConfirmingRemove(false);
    }
  }

  const updateFilters = (patch: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
  };

  const toggleArrayValue = (key: keyof FilterState, value: string) => {
    setFilters((f) => {
      const cur = (f[key] as string[]) ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [key]: next };
    });
  };

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateFilters({ q: v }), 250);
  };

  const activeFilterCount =
    filters.supertype.length +
    filters.type.length +
    filters.regulation.length +
    (filters.ownership === "owned" ? filters.variant.length : 0) +
    filters.setId.length +
    (filters.hpMin != null ? 1 : 0) +
    (filters.hpMax != null ? 1 : 0) +
    (filters.priceMin != null ? 1 : 0) +
    (filters.priceMax != null ? 1 : 0) +
    filters.rarity.length +
    filters.retreatCost.length;

  const clearFilters = () => {
    setFilters((f) => ({
      ...f,
      supertype: [],
      type: [],
      regulation: [],
      setId: [],
      hpMin: undefined,
      hpMax: undefined,
      priceMin: undefined,
      priceMax: undefined,
      rarity: [],
      retreatCost: [],
      variant: [],
    }));
  };

  async function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      setNameDraft(name);
      return;
    }
    setRenameBusy(true);
    const prev = name;
    setName(trimmed);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) setName(prev);
    } catch {
      setName(prev);
    } finally {
      setRenameBusy(false);
      setRenaming(false);
    }
  }

  async function toggleVisibility() {
    if (visibilityBusy) return;
    const next = !isPublic;
    setVisibilityBusy(true);
    setIsPublic(next);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: next }),
      });
      if (!res.ok) setIsPublic(!next);
    } catch {
      setIsPublic(!next);
    } finally {
      setVisibilityBusy(false);
    }
  }

  function handleShareClick() {
    setMenuOpen(false);
    if (isPublic) {
      setShareOpen(true);
      return;
    }
    setConfirmingMakePublic(true);
  }

  async function makePublicAndShare() {
    if (visibilityBusy) return;
    setVisibilityBusy(true);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: true }),
      });
      if (res.ok) {
        setIsPublic(true);
        setConfirmingMakePublic(false);
        setShareOpen(true);
      }
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function performDelete() {
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
      if (res.ok) router.push(`/u/${username}`);
    } catch {
      /* silent — user can retry */
    } finally {
      setDeleting(false);
    }
  }

  return (
      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] xl:pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-24">
        <div className="hidden xl:block mb-6">
          <BackButton href={`/u/${username}`} ariaLabel={`Back to @${username}'s lists`} />
        </div>

        <div className="mb-6 flex items-end justify-between gap-3">
          {renaming ? (
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveRename();
                } else if (e.key === "Escape") {
                  setNameDraft(name);
                  setRenaming(false);
                }
              }}
              disabled={renameBusy}
              autoFocus
              className="min-w-0 flex-1 text-3xl md:text-4xl font-semibold tracking-tight text-text-primary bg-transparent border-b-2 border-accent focus:outline-none disabled:opacity-50"
            />
          ) : (
            <h2 className="min-w-0 flex-1 truncate text-3xl md:text-4xl font-semibold tracking-tight text-text-primary">
              {name}
            </h2>
          )}

          {isOwner && (
            <div className="shrink-0">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="List actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex items-center justify-center h-[38px] w-[38px] rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.75" />
                  <circle cx="12" cy="12" r="1.75" />
                  <circle cx="19" cy="12" r="1.75" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {!isOwner && (
          <p className="-mt-4 mb-6 text-sm text-text-secondary">
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </p>
        )}

        {isOwner &&
          menuOpen &&
          menuPos !== null &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
              className="w-48 rounded-xl bg-white dark:bg-surface-elevated border border-black/8 dark:border-white/10 shadow-lg p-1 z-50"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleShareClick}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
              >
                Share
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNameDraft(name);
                  setRenaming(true);
                  setMenuOpen(false);
                }}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors"
              >
                Rename list
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleVisibility();
                  setMenuOpen(false);
                }}
                disabled={visibilityBusy}
                aria-pressed={isPublic}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                {isPublic ? "Make private" : "Make public"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setConfirmingDelete(true);
                  setMenuOpen(false);
                }}
                disabled={deleting}
                className="w-full text-left rounded-lg px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                Delete list
              </button>
            </div>,
            document.body,
          )}

        <ShareQRModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          url={canonicalShareUrl}
          title="Share List"
        />

        {confirmingMakePublic &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="make-list-public-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmingMakePublic(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="make-list-public-title" className="text-base font-semibold text-text-primary">
                  Make this list public?
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  This list is private, so only you can see it. Make it public so anyone with the link can view it?
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingMakePublic(false)}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={makePublicAndShare}
                    disabled={visibilityBusy}
                    className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
                  >
                    {visibilityBusy ? "Making public…" : "Make public & share"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {confirmingDelete &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-list-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="delete-list-title" className="text-base font-semibold text-text-primary">
                  Delete this list?
                </h2>
                <p className="mt-2 text-sm text-text-secondary">This cannot be undone.</p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={performDelete}
                    disabled={deleting}
                    className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {confirmingRemove &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="remove-cards-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
              onClick={() => setConfirmingRemove(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl bg-white/95 dark:bg-surface-elevated backdrop-blur-xl border border-black/5 dark:border-white/10 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.4)]"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="remove-cards-title" className="text-base font-semibold text-text-primary">
                  Are you sure?
                </h2>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white dark:bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-secondary hover:bg-black/5 transition touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveSelected}
                    disabled={removing}
                    className="inline-flex items-center justify-center rounded-full bg-black dark:bg-white px-4 py-1.5 text-xs font-semibold text-white dark:text-black disabled:opacity-50 hover:opacity-80 transition-opacity touch-manipulation"
                  >
                    {removing ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-6 text-center">
            <p className="text-sm text-text-secondary">
              No cards in this list yet. Add cards from any card&apos;s detail page.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <div className="flex-1 relative">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
                >
                  <circle cx="9" cy="9" r="6" />
                  <path d="m17 17-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="Search this list"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
                />
              </div>
              <div className="flex items-center gap-2">
                <PillSelect
                  value={`${sort}:${dir}`}
                  onChange={(e) => {
                    const [s, d] = e.target.value.split(":") as [SortKey, SortDir];
                    setSort(s);
                    setDir(d);
                  }}
                >
                  <option value="released:desc">Set ↓</option>
                  <option value="released:asc">Set ↑</option>
                  <option value="name:asc">Card Name ↑</option>
                  <option value="name:desc">Card Name ↓</option>
                  <option value="hp:desc">Hit Points ↓</option>
                  <option value="hp:asc">Hit Points ↑</option>
                  <option value="price:desc">Market Price ↓</option>
                  <option value="price:asc">Market Price ↑</option>
                  <option value="rarity:desc">Rarity ↓</option>
                  <option value="rarity:asc">Rarity ↑</option>
                </PillSelect>
                <button
                  onClick={() => setShowFilters((s) => !s)}
                  className={`text-xs font-semibold h-[38px] px-3 rounded-full transition ${
                    activeFilterCount > 0
                      ? "border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg"
                      : "border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface"
                  }`}
                >
                  {activeFilterCount > 0 ? "Filtered" : "Filters"}
                </button>
                <GridListToggle value={view} onChange={setView} />
                {view === "grid" && (
                  <GridDensityMenu value={columns} onChange={chooseColumns} />
                )}
              </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-4 mb-4 space-y-4">
                {activeFilterCount > 0 && (
                  <div className="pb-3 border-b border-black/8 dark:border-white/10">
                    <button
                      onClick={clearFilters}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface transition-colors"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
                <SetFacet
                  sets={facets.sets}
                  selected={filters.setId}
                  onToggle={(v) => toggleArrayValue("setId", v)}
                />
                <FacetGroup
                  label="Rarity"
                  options={facets.rarities}
                  selected={filters.rarity}
                  onToggle={(v) => toggleArrayValue("rarity", v)}
                />
                <FacetGroup
                  label="Card Type"
                  options={facets.supertypes}
                  selected={filters.supertype}
                  onToggle={(v) => toggleArrayValue("supertype", v)}
                />
                <FacetGroup
                  label="Energy"
                  options={facets.types}
                  selected={filters.type}
                  onToggle={(v) => toggleArrayValue("type", v)}
                />
                {filters.ownership === "owned" && (
                  <FacetGroup
                    label="Variant"
                    options={ownedVariantLabels}
                    selected={filters.variant}
                    onToggle={(v) => toggleArrayValue("variant", v)}
                  />
                )}
                <FacetGroup
                  label="Regulation"
                  options={facets.regulations}
                  selected={filters.regulation}
                  onToggle={(v) => toggleArrayValue("regulation", v)}
                />
                <FacetGroup
                  label="Retreat Cost"
                  options={facets.retreatCosts.map(String)}
                  selected={filters.retreatCost.map(String)}
                  onToggle={(v) => {
                    const n = Number(v);
                    setFilters((f) => {
                      const cur = f.retreatCost;
                      const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
                      return { ...f, retreatCost: next };
                    });
                  }}
                />
                <RangeFacet
                  label="HP"
                  min={filters.hpMin}
                  max={filters.hpMax}
                  onChange={(min, max) => updateFilters({ hpMin: min, hpMax: max })}
                />
                <RangeFacet
                  label="Market Price"
                  min={filters.priceMin}
                  max={filters.priceMax}
                  step={0.5}
                  onChange={(min, max) => updateFilters({ priceMin: min, priceMax: max })}
                />
              </div>
            )}

            {/* Ownership scope + select mode */}
            {selectMode ? (
              <div className="flex items-center gap-2 -mt-2 mb-4">
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="shrink-0 text-xs font-semibold h-[38px] px-4 rounded-full border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(true)}
                    disabled={selected.size === 0 || removing}
                    className="flex-1 text-xs font-semibold h-[38px] rounded-full border border-accent/30 dark:border-accent bg-white dark:bg-surface-2 text-accent dark:text-white disabled:opacity-40 hover:bg-accent/5 transition-colors"
                  >
                    {removing
                      ? "Removing…"
                      : `Remove ${selected.size} ${selected.size === 1 ? "card" : "cards"} from list`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAddDialogOpen(true)}
                  disabled={selected.size === 0}
                  className="flex-1 text-xs font-semibold h-[38px] rounded-full border border-transparent bg-black dark:bg-white text-white dark:text-black disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  Add {selected.size} {selected.size === 1 ? "card" : "cards"} to list
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 -mt-2 mb-4">
                <OwnershipRadios
                  value={filters.ownership}
                  onChange={(v) =>
                    updateFilters({ ownership: v, ...(v !== "owned" ? { variant: [] } : {}) })
                  }
                />
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  className="shrink-0 text-xs font-semibold h-[38px] px-4 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface transition-colors"
                >
                  Select
                </button>
              </div>
            )}

            <ListDetails cards={cards} />

            <VariantFilteredView
              cards={sortedCards}
              variantFilter={filters.ownership === "owned" ? filters.variant : []}
              view={view}
              columns={columns}
              selectMode={selectMode}
              selectedOrder={selectedOrder}
              onToggleSelect={toggleSelect}
            />
          </>
        )}

        <AddSelectionToListDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          cards={Array.from(selected.values()).map((c) => ({ setId: c.setId, number: c.number }))}
          onAdded={exitSelectMode}
        />
      </main>
  );
}
