"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cardImageSmall } from "@/lib/cardImages";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import type { SortKey, SortDir, OwnershipFilter } from "@/lib/cardSearch";
import { COLLECTION_VARIANTS } from "@/lib/inventory";
import CardImage from "./CardImage";
import CardFooterOverlay from "./CardFooterOverlay";
import InventoryProvider, { useInventory } from "./InventoryContext";
import {
  InventoryCapsule,
  InventoryOverlay,
  type InventoryMenuMode,
} from "./InventoryCapsule";
import SectionHeader from "@/app/components/ui/SectionHeader";
import PillSelect from "@/app/components/ui/PillSelect";

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

export default function CardsClient({ initialResult, facets, initialParams }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [params, setParams] = useState<Params>(initialParams);
  const [searchInput, setSearchInput] = useState(initialParams.q);
  const [showFilters, setShowFilters] = useState(false);
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

  const totalPages = Math.max(1, Math.ceil(initialResult.total / params.pageSize));

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
      <div className="mb-6">
        <SectionHeader title="Card Catalog" />
      </div>

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
            className="w-full pl-10 pr-4 py-2 rounded-full border border-black/10 bg-white text-[16px] sm:text-sm focus:outline-none focus-gradient-border transition-colors"
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
            <option value="released:desc">Set (New to Old)</option>
            <option value="released:asc">Set (Old to New)</option>
            <option value="name:asc">Card Name (A–Z)</option>
            <option value="name:desc">Card Name (Z–A)</option>
            <option value="hp:desc">Hit Points (High to Low)</option>
            <option value="hp:asc">Hit Points (Low to High)</option>
            <option value="price:desc">Market Price (High to Low)</option>
            <option value="price:asc">Market Price (Low to High)</option>
            <option value="rarity:desc">Rarity (Descending)</option>
            <option value="rarity:asc">Rarity (Ascending)</option>
          </PillSelect>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`text-xs font-semibold h-[38px] px-3 rounded-full transition ${
              activeFilterCount > 0
                ? "border border-transparent bg-gradient-brand bg-origin-border text-white shadow-brand hover:shadow-brand-lg"
                : "border border-black/10 bg-white hover:bg-surface"
            }`}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          <div className="inline-flex h-[38px] rounded-full border border-black/10 bg-white overflow-hidden">
            <button
              onClick={() => updateParams({ view: "grid" })}
              className={`text-xs font-semibold px-3 transition-colors ${
                params.view === "grid" ? "bg-black text-white" : "hover:bg-surface"
              }`}
              aria-label="Grid view"
            >
              Grid
            </button>
            <button
              onClick={() => updateParams({ view: "list" })}
              className={`text-xs font-semibold px-3 transition-colors ${
                params.view === "list" ? "bg-black text-white" : "hover:bg-surface"
              }`}
              aria-label="List view"
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-2xl border border-black/8 bg-white p-4 mb-4 space-y-4">
          <FacetGroup
            label="Supertype"
            options={facets.supertypes}
            selected={params.supertype}
            onToggle={(v) => toggleArrayValue("supertype", v)}
          />
          <FacetGroup
            label="Type"
            options={facets.types}
            selected={params.type}
            onToggle={(v) => toggleArrayValue("type", v)}
          />
          {params.ownership === "owned" && (
            <FacetGroup
              label="Variant Type"
              options={COLLECTION_VARIANTS.map((v) => v.label)}
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
            label="Rarity"
            options={facets.rarities}
            selected={params.rarity}
            onToggle={(v) => toggleArrayValue("rarity", v)}
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
          <SetFacet
            sets={facets.sets}
            selected={params.setId}
            onToggle={(v) => toggleArrayValue("setId", v)}
          />
          <RangeFacet
            label="HP"
            min={params.hpMin}
            max={params.hpMax}
            onChange={(min, max) => updateParams({ hpMin: min, hpMax: max })}
          />
          <RangeFacet
            label="Price ($)"
            min={params.priceMin}
            max={params.priceMax}
            step={0.5}
            onChange={(min, max) => updateParams({ priceMin: min, priceMax: max })}
          />
          {activeFilterCount > 0 && (
            <div className="pt-2 border-t border-black/8">
              <button
                onClick={clearFilters}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white hover:bg-surface transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ownership scope */}
      <OwnershipRadios
        value={params.ownership}
        onChange={(v) => updateParams({ ownership: v, ...(v !== "owned" ? { variant: [] } : {}) })}
      />

      {/* Results */}
      <VariantFilteredView
        cards={initialResult.cards}
        variantFilter={params.ownership === "owned" ? params.variant : []}
        view={params.view}
      />

      {/* Pagination */}
      {initialResult.total > params.pageSize && (
        <Pagination
          page={params.page}
          totalPages={totalPages}
          pageSize={params.pageSize}
          onPage={(p) => setParams((cur) => ({ ...cur, page: p }))}
          onPageSize={(ps) => updateParams({ pageSize: ps })}
        />
      )}
    </main>
    </InventoryProvider>
  );
}

function VariantFilteredView({
  cards,
  variantFilter,
  view,
}: {
  cards: CardIndexEntry[];
  variantFilter: string[];
  view: "grid" | "list";
}) {
  const { presentVariants } = useInventory();
  const displayed = useMemo(() => {
    if (variantFilter.length === 0) return cards;
    return cards.filter((c) =>
      presentVariants(c.setId, c.number).some((v) =>
        variantFilter.includes(COLLECTION_VARIANTS.find((x) => x.key === v)?.label ?? "")
      )
    );
  }, [cards, variantFilter, presentVariants]);

  if (displayed.length === 0) {
    return (
      <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-8 text-center">
        <p className="text-sm text-text-secondary">No cards match these filters.</p>
      </div>
    );
  }
  return view === "grid" ? <GridView cards={displayed} /> : <ListView cards={displayed} />;
}

function OwnershipRadios({
  value,
  onChange,
}: {
  value: OwnershipFilter;
  onChange: (v: OwnershipFilter) => void;
}) {
  const options: Array<{ key: OwnershipFilter; label: string }> = [
    { key: "all", label: "All Cards" },
    { key: "owned", label: "Owned" },
    { key: "unowned", label: "Unowned" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Ownership scope"
      className="flex items-center gap-4 mb-4"
    >
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <label
            key={o.key}
            className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-text-secondary"
          >
            <input
              type="radio"
              name="ownership"
              value={o.key}
              checked={selected}
              onChange={() => onChange(o.key)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                selected
                  ? "border-accent bg-white"
                  : "border-black/25 bg-white peer-hover:border-black/50"
              }`}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
            <span className={selected ? "text-text-primary" : ""}>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function FacetGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-black text-white border-transparent"
                  : "bg-white text-text-secondary border-black/10 hover:bg-surface"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SetFacet({
  sets,
  selected,
  onToggle,
}: {
  sets: Array<{ id: string; name: string; ptcgoCode: string | null }>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return sets;
    return sets.filter(
      (s) => s.name.toLowerCase().includes(f) || s.ptcgoCode?.toLowerCase().includes(f)
    );
  }, [sets, filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-text-secondary">Set</div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sets…"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white w-40"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {filtered.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onToggle(s.id)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-black text-white border-transparent"
                  : "bg-white text-text-secondary border-black/10 hover:bg-surface"
              }`}
              title={s.id}
            >
              {s.name}
              {s.ptcgoCode ? ` (${s.ptcgoCode})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeFacet({
  label,
  min,
  max,
  step = 10,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary mb-2">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={step}
          value={min ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value), max)}
          placeholder="Min"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white w-24"
        />
        <span className="text-xs text-text-muted">to</span>
        <input
          type="number"
          step={step}
          value={max ?? ""}
          onChange={(e) => onChange(min, e.target.value === "" ? undefined : Number(e.target.value))}
          placeholder="Max"
          className="text-xs px-2 py-1 rounded-full border border-black/10 bg-white w-24"
        />
      </div>
    </div>
  );
}

function GridView({ cards }: { cards: CardIndexEntry[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <GridTile key={c.id} card={c} />
      ))}
    </div>
  );
}

function GridTile({ card: c }: { card: CardIndexEntry }) {
  const [mode, setMode] = useState<InventoryMenuMode | null>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-full" style={{ aspectRatio: "245 / 342" }}>
        <Link
          href={`/cards/${encodeURIComponent(c.id)}`}
          className="group absolute inset-0 block rounded-xl overflow-hidden bg-surface hover:shadow-md transition-shadow"
        >
          <CardImage
            src={cardImageSmall(c.setId, c.number)}
            alt={`${c.name} — ${c.setName} ${c.number}`}
            name={c.name}
            setName={c.setName}
            number={c.number}
            className="w-full h-full object-contain transition-transform group-hover:scale-[1.02]"
          />
          <CardFooterOverlay
            setCode={c.ptcgoCode}
            setId={c.setId}
            number={c.number}
            setSize={c.setSize}
          />
        </Link>
        {mode && (
          <InventoryOverlay
            setId={c.setId}
            number={c.number}
            rarity={c.rarity}
            mode={mode}
            display="card"
            onClose={() => setMode(null)}
          />
        )}
      </div>
      <div className="grid grid-cols-2 items-center w-full gap-2">
        <span className="text-xs font-semibold tabular-nums text-text-primary truncate pl-2">
          {formatGridPrice(c.marketPrice)}
        </span>
        <div className="justify-self-end">
          <InventoryCapsule
            setId={c.setId}
            number={c.number}
            onOpenMenu={(m) => setMode(m)}
          />
        </div>
      </div>
    </div>
  );
}

function formatGridPrice(p: number): string {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return `$${Math.round(p).toLocaleString()}`;
  return `$${p.toFixed(2)}`;
}

function ListView({ cards }: { cards: CardIndexEntry[] }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white overflow-hidden">
      <div className="hidden md:grid grid-cols-[64px_2fr_1.5fr_80px_80px_80px_80px_100px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted border-b border-black/8">
        <span></span>
        <span>Name</span>
        <span>Set</span>
        <span>Number</span>
        <span>Type</span>
        <span>HP</span>
        <span className="text-right">Price</span>
        <span className="text-right">Owned</span>
      </div>
      <ul>
        {cards.map((c, i) => (
          <ListRow key={c.id} card={c} isFirst={i === 0} />
        ))}
      </ul>
    </div>
  );
}

function ListRow({ card: c, isFirst }: { card: CardIndexEntry; isFirst: boolean }) {
  const [mode, setMode] = useState<InventoryMenuMode | null>(null);
  return (
    <li className={`relative ${isFirst ? "" : "border-t border-black/8"}`}>
      <Link
        href={`/cards/${encodeURIComponent(c.id)}`}
        className="grid grid-cols-[48px_1fr_auto] md:grid-cols-[64px_2fr_1.5fr_80px_80px_80px_80px_100px] gap-3 px-4 py-2 items-center hover:bg-surface transition-colors"
      >
        <CardImage
          src={cardImageSmall(c.setId, c.number)}
          alt={`${c.name} — ${c.setName} ${c.number}`}
          name={c.name}
          setName={c.setName}
          number={c.number}
          className="w-12 h-[68px] md:w-14 md:h-[78px] object-cover rounded-md bg-surface text-[9px]"
        />
        <div className="md:contents">
          <span className="text-sm font-medium text-text-primary truncate">{c.name}</span>
          <span className="hidden md:inline text-sm text-text-secondary truncate">
            {c.setName}
            {c.ptcgoCode ? ` · ${c.ptcgoCode}` : ""}
          </span>
          <span className="hidden md:inline text-sm text-text-secondary">{c.number}</span>
          <span className="hidden md:inline text-sm text-text-secondary">
            {c.types.join(", ") || c.supertype}
          </span>
          <span className="hidden md:inline text-sm text-text-secondary">{c.hp ?? "—"}</span>
          <span className="hidden md:inline text-sm text-text-secondary text-right">
            {c.marketPrice > 0 ? `$${c.marketPrice.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="justify-self-end md:justify-self-end">
          <InventoryCapsule
            setId={c.setId}
            number={c.number}
            onOpenMenu={(m) => setMode(m)}
          />
        </div>
      </Link>
      {mode && (
        <InventoryOverlay
          setId={c.setId}
          number={c.number}
          rarity={c.rarity}
          cardName={c.name}
          mode={mode}
          display="modal"
          onClose={() => setMode(null)}
        />
      )}
    </li>
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
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
        >
          ← Prev
        </button>
        <span className="text-xs text-text-secondary">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={!canNext}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white disabled:opacity-40 hover:bg-surface transition-colors"
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

