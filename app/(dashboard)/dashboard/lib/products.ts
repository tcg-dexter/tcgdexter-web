// TCG Dexter's product surfaces. The Analytics page is organised by these
// six rather than by raw event prefix so the team can answer "which Product
// is paying off?" without translating event names in their head.
//
// Each Product owns a set of event-name prefixes. A prefix that has no
// matching Product falls through to "Other" — currently nothing routes there,
// but the bucket exists so a misnamed event surfaces visibly instead of
// silently disappearing.

export type ProductKey =
  | "card_catalog"
  | "deck_collection"
  | "meta_archetypes"
  | "playmat_studio"
  | "spotlight"
  | "learn_to_play"
  | "other";

export type ProductMeta = {
  key: ProductKey;
  label: string;
  description: string;
  // Event-name prefixes (everything before the first `.`) that belong to
  // this Product. Empty array = no instrumentation yet.
  prefixes: string[];
};

export const PRODUCTS: ProductMeta[] = [
  {
    key: "card_catalog",
    label: "Cards",
    description: "Browse and look up individual cards",
    prefixes: [],
  },
  {
    key: "deck_collection",
    label: "Deck Collection",
    description: "Paste, analyze, save, share, and log matches against your decks",
    prefixes: ["analyze", "deck", "match"],
  },
  {
    key: "meta_archetypes",
    label: "Meta Archetypes",
    description: "Top decks and the current meta picture",
    prefixes: ["meta"],
  },
  {
    key: "playmat_studio",
    label: "Playmat Studio",
    description: "Custom playmat designer",
    prefixes: ["playmat"],
  },
  {
    key: "spotlight",
    label: "Spotlight",
    description: "Trainer profiles and community spotlights",
    prefixes: ["spotlight"],
  },
  {
    key: "learn_to_play",
    label: "Learn to Play",
    description: "Onboarding for new TCG players",
    prefixes: ["learn"],
  },
  {
    key: "other",
    label: "Other",
    description: "Events that don't yet map to a Product",
    prefixes: [],
  },
];

// Per-product palette — chip + bar + sparkline stroke share a hue so each
// Product card reads as a single colour identity.
export const PRODUCT_CHIP: Record<ProductKey, string> = {
  card_catalog: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  deck_collection: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  meta_archetypes: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  playmat_studio: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  spotlight: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  learn_to_play: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  other: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white/70",
};

export const PRODUCT_BAR: Record<ProductKey, string> = {
  card_catalog: "bg-emerald-500",
  deck_collection: "bg-sky-500",
  meta_archetypes: "bg-violet-500",
  playmat_studio: "bg-amber-500",
  spotlight: "bg-rose-500",
  learn_to_play: "bg-indigo-500",
  other: "bg-gray-400",
};

export const PRODUCT_STROKE: Record<ProductKey, string> = {
  card_catalog: "#10b981",
  deck_collection: "#0ea5e9",
  meta_archetypes: "#8b5cf6",
  playmat_studio: "#f59e0b",
  spotlight: "#f43f5e",
  learn_to_play: "#6366f1",
  other: "#9ca3af",
};

// Auth events drive the funnel + north-star, not Product usage. Listed here
// so the Product mapper can skip them cleanly.
const AUTH_PREFIXES = new Set(["auth"]);

export function isAuthEvent(eventName: string): boolean {
  return AUTH_PREFIXES.has(eventName.split(".")[0]);
}

// Cached prefix → ProductKey index built once on module load.
const PREFIX_INDEX: Map<string, ProductKey> = (() => {
  const m = new Map<string, ProductKey>();
  for (const p of PRODUCTS) {
    for (const prefix of p.prefixes) m.set(prefix, p.key);
  }
  return m;
})();

export function productOf(eventName: string): ProductKey {
  const prefix = eventName.split(".")[0];
  return PREFIX_INDEX.get(prefix) ?? "other";
}
