"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { CardIndexEntry, SetStats } from "@/lib/cardsIndex";
import type { SortKey, SortDir, OwnershipFilter } from "@/lib/cardSearch";
import { variantDisplayLabel } from "@/lib/inventory";
import DataView from "./DataView";
import ListsView from "./ListsView";
import InventoryProvider, { useInventory } from "./InventoryContext";
import PillSelect from "@/app/components/ui/PillSelect";
import GridListToggle from "@/app/components/ui/GridListToggle";
import {
  OwnershipRadios,
  FacetGroup,
  SetFacet,
  RangeFacet,
  VariantFilteredView,
} from "./FilterControls";
import AddSelectionToListDialog from "./AddSelectionToListDialog";

interface Facets {
  supertypes: string[];
  types: string[];
  regulations: string[];
  rarities: string[];
  retreatCosts: number[];
  sets: Array<{ id: string; name: string; ptcgoCode: string | null }>;
}

interface Params {
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
  sort: SortKey;
  dir: SortDir;
  page: number;
  pageSize: number;
  view: "grid" | "list";
  ownership: OwnershipFilter;
  variant: string[];
}

interface Props {
  initialResult: { cards: CardIndexEntry[]; total: number; page: number; pageSize: number };
  facets: Facets;
  setStats: SetStats[];
  initialParams: Params;
}

function buildUrl(pathname: string, params: Params): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.supertype.length) sp.set("supertype", params.supertype.join(","));
  if (params.type.length) sp.set("type", params.type.join(","));
  if (params.regulation.length) sp.set("regulation", params.regulation.join(","));
  if (params.setId.length) sp.set("setId", params.setId.join(","));
  if (params.hpMin != null) sp.set("hpMin", String(params.hpMin));
  if (params.hpMax != null) sp.set("hpMax", String(params.hpMax));
  if (params.priceMin != null) sp.set("priceMin", String(params.priceMin));
  if (params.priceMax != null) sp.set("priceMax", String(params.priceMax));
  if (params.rarity.length) sp.set("rarity", params.rarity.join(","));
  if (params.retreatCost.length) sp.set("retreatCost", params.retreatCost.map(String).join(","));
  const defaultDir = params.sort === "name" || params.sort === "number" ? "asc" : "desc";
  if (params.sort !== "released") sp.set("sort", params.sort);
  if (params.dir !== defaultDir) sp.set("dir", params.dir);
  if (params.page !== 1) sp.set("page", String(params.page));
  if (params.pageSize !== 60) sp.set("pageSize", String(params.pageSize));
  if (params.view !== "grid") sp.set("view", params.view);
  if (params.ownership !== "all") sp.set("ownership", params.ownership);
  if (params.ownership === "owned" && params.variant.length) sp.set("variant", params.variant.join(","));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function CardsClient({ initialResult, facets, setStats, initialParams }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [params, setParams] = useState<Params>(initialParams);
  const [searchInput, setSearchInput] = useState(initialParams.q);
  const [showFilters, setShowFilters] = useState(false);
  const [mode, setMode] = useState<"catalog" | "data" | "lists">("catalog");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSync = useRef(true);

  // Push to URL when params change (debounced for `q`).
  useEffect(() => {
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    const url = buildUrl(pathname, params);
    startTransition(() => router.replace(url, { scroll: false }));
  }, [params, pathname, router]);

  // Re-derive params if URL changes externally (e.g. back/forward).
  useEffect(() => {
    setSearchInput(params.q);
  }, [params.q]);

  const updateParams = (patch: Partial<Params>) => {
    setParams((p) => ({ ...p, page: 1, ...patch }));
  };

  const toggleArrayValue = (key: keyof Params, value: string) => {
    setParams((p) => {
      const cur = (p[key] as string[]) ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...p, [key]: next, page: 1 };
    });
  };

  const handleSearchInput = (v: string) => {
    setSearchInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: v }), 250);
  };

  const activeFilterCount =
    params.supertype.length +
    params.type.length +
    params.regulation.length +
    (params.ownership === "owned" ? params.variant.length : 0) +
    params.setId.length +
    (params.hpMin != null ? 1 : 0) +
    (params.hpMax != null ? 1 : 0) +
    (params.priceMin != null ? 1 : 0) +
    (params.priceMax != null ? 1 : 0) +
    params.rarity.length +
    params.retreatCost.length;

  const clearFilters = () => {
    setParams((p) => ({
      ...p,
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
      page: 1,
    }));
  };

  return (
    <InventoryProvider>
    <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      <div className="mb-6 flex items-end justify-between gap-3">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-text-primary">
          Card Catalog
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMode((m) => (m === "data" ? "catalog" : "data"))}
            aria-pressed={mode === "data"}
            aria-label={mode === "data" ? "Switch to catalog view" : "Switch to set progress view"}
            title={mode === "data" ? "Switch to catalog view" : "Switch to set progress view"}
            className={`inline-flex items-center justify-center gap-1.5 h-[38px] px-4 rounded-full border transition-colors ${
              mode === "data"
                ? "border-transparent bg-black dark:bg-white text-white dark:text-black"
                : "border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 shrink-0"
            >
              <path d="M3 16.5h14" />
              <path d="M6 16.5V11" />
              <path d="M10 16.5V6" />
              <path d="M14 16.5v-7.5" />
            </svg>
            <span className="text-xs font-semibold">Sets</span>
          </button>
          <button
            type="button"
            onClick={() => setMode((m) => (m === "lists" ? "catalog" : "lists"))}
            aria-pressed={mode === "lists"}
            aria-label={mode === "lists" ? "Switch to catalog view" : "Switch to your lists"}
            title={mode === "lists" ? "Switch to catalog view" : "Switch to your lists"}
            className={`inline-flex items-center justify-center gap-1.5 h-[38px] px-4 rounded-full border transition-colors ${
              mode === "lists"
                ? "border-transparent bg-black dark:bg-white text-white dark:text-black"
                : "border-black/10 bg-white dark:bg-surface-2 text-text-primary hover:bg-surface"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 shrink-0"
            >
              <path d="M7 5.5h9" />
              <path d="M7 10h9" />
              <path d="M7 14.5h9" />
              <path d="M4 5.5h.01" />
              <path d="M4 10h.01" />
              <path d="M4 14.5h.01" />
            </svg>
            <span className="text-xs font-semibold">Lists</span>
          </button>
        </div>
      </div>

      {mode === "data" ? (
        <DataView
          setStats={setStats}
          onSelectSet={(setId) => {
            setParams((p) => ({ ...p, setId: [setId], page: 1 }));
            setMode("catalog");
          }}
        />
      ) : mode === "lists" ? (
        <ListsView />
      ) : (
        <CatalogBody
          initialResult={initialResult}
          facets={facets}
          params={params}
          setParams={setParams}
          searchInput={searchInput}
          handleSearchInput={handleSearchInput}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          updateParams={updateParams}
          toggleArrayValue={toggleArrayValue}
          clearFilters={clearFilters}
          activeFilterCount={activeFilterCount}
        />
      )}
    </main>
    </InventoryProvider>
  );
}

interface CatalogBodyProps {
  initialResult: Props["initialResult"];
  facets: Facets;
  params: Params;
  setParams: React.Dispatch<React.SetStateAction<Params>>;
  searchInput: string;
  handleSearchInput: (v: string) => void;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  updateParams: (patch: Partial<Params>) => void;
  toggleArrayValue: (key: keyof Params, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

function CatalogBody({
  initialResult,
  facets,
  params,
  setParams,
  searchInput,
  handleSearchInput,
  showFilters,
  setShowFilters,
  updateParams,
  toggleArrayValue,
  clearFilters,
  activeFilterCount,
}: CatalogBodyProps) {
  const totalPages = Math.max(1, Math.ceil(initialResult.total / params.pageSize));
  // Variant facet options come from the collection itself. The vocabulary is
  // the open printing grammar now, so there's no fixed list to enumerate —
  // and showing only what someone owns keeps the filter short and relevant.
  const { ownedVariants } = useInventory();
  const ownedVariantLabels = useMemo(
    () => Array.from(new Set(ownedVariants.map(variantDisplayLabel))),
    [ownedVariants],
  );

  // Multi-select (id -> card, insertion order = selection order) feeding the
  // bulk "Add to list" dialog. Selection persists across pagination/filter
  // changes since it's keyed by card id, not by the current result page.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, CardIndexEntry>>(new Map());
  const [addDialogOpen, setAddDialogOpen] = useState(false);
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

  return (
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
            placeholder="Search cards"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <PillSelect
            value={`${params.sort}:${params.dir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(":") as [SortKey, SortDir];
              updateParams({ sort: s, dir: d });
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
          <GridListToggle
            value={params.view}
            onChange={(v) => updateParams({ view: v })}
          />
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
            selected={params.setId}
            onToggle={(v) => toggleArrayValue("setId", v)}
          />
          <FacetGroup
            label="Rarity"
            options={facets.rarities}
            selected={params.rarity}
            onToggle={(v) => toggleArrayValue("rarity", v)}
          />
          <FacetGroup
            label="Card Type"
            options={facets.supertypes}
            selected={params.supertype}
            onToggle={(v) => toggleArrayValue("supertype", v)}
          />
          <FacetGroup
            label="Energy"
            options={facets.types}
            selected={params.type}
            onToggle={(v) => toggleArrayValue("type", v)}
          />
          {params.ownership === "owned" && (
            <FacetGroup
              label="Variant"
              options={ownedVariantLabels}
              selected={params.variant}
              onToggle={(v) => toggleArrayValue("variant", v)}
            />
          )}
          <FacetGroup
            label="Regulation"
            options={facets.regulations}
            selected={params.regulation}
            onToggle={(v) => toggleArrayValue("regulation", v)}
          />
          <FacetGroup
            label="Retreat Cost"
            options={facets.retreatCosts.map(String)}
            selected={params.retreatCost.map(String)}
            onToggle={(v) => {
              const n = Number(v);
              setParams((p) => {
                const cur = p.retreatCost;
                const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
                return { ...p, retreatCost: next, page: 1 };
              });
            }}
          />
          <RangeFacet
            label="HP"
            min={params.hpMin}
            max={params.hpMax}
            onChange={(min, max) => updateParams({ hpMin: min, hpMax: max })}
          />
          <RangeFacet
            label="Market Price"
            min={params.priceMin}
            max={params.priceMax}
            step={0.5}
            onChange={(min, max) => updateParams({ priceMin: min, priceMax: max })}
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
            value={params.ownership}
            onChange={(v) => updateParams({ ownership: v, ...(v !== "owned" ? { variant: [] } : {}) })}
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

      {/* Results */}
      <VariantFilteredView
        cards={initialResult.cards}
        variantFilter={params.ownership === "owned" ? params.variant : []}
        view={params.view}
        selectMode={selectMode}
        selectedOrder={selectedOrder}
        onToggleSelect={toggleSelect}
      />

      {/* Pagination */}
      {initialResult.total > params.pageSize && (
        <Pagination
          page={params.page}
          totalPages={totalPages}
          pageSize={params.pageSize}
          onPage={(p) => {
            // Snap to the top before the new page's cards mount, so their
            // cascade animation plays in view instead of racing a smooth
            // scroll that's still in progress while off-screen.
            window.scrollTo(0, 0);
            setParams((cur) => ({ ...cur, page: p }));
          }}
          onPageSize={(ps) => updateParams({ pageSize: ps })}
        />
      )}

      <AddSelectionToListDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        cards={Array.from(selected.values()).map((c) => ({ setId: c.setId, number: c.number }))}
        onAdded={exitSelectMode}
      />
    </>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
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
          <option value={60}>60</option>
          <option value={120}>120</option>
          <option value={240}>240</option>
        </PillSelect>
      </div>
    </div>
  );
}

