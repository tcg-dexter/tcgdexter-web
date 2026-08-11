"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { type CollectionVariantKey } from "@/lib/inventory";
import { compareVariants } from "@/lib/variants";

type VariantMap = Partial<Record<CollectionVariantKey, number>>;
type CollectionMap = Record<string, VariantMap>;

interface InventoryCtx {
  signedIn: boolean | null;
  collection: CollectionMap;
  /** Total qty across all variants for a (setId, number). */
  totalFor: (setId: string, number: string) => number;
  /** Variants this card has at least one of, in canonical order. */
  presentVariants: (setId: string, number: string) => CollectionVariantKey[];
  /** Every distinct variant owned anywhere in the collection, in canonical
   *  order. Drives the catalog's Variant facet — the vocabulary is open now,
   *  so the options have to come from the data rather than a fixed list. */
  ownedVariants: CollectionVariantKey[];
  /** Apply a delta. Optimistic; rolls back on server error. Requires sign-in. */
  adjust: (
    setId: string,
    number: string,
    variant: CollectionVariantKey,
    delta: number,
  ) => Promise<void>;
  /** Open the sign-in prompt modal for signed-out interactions. */
  promptSignIn: () => void;
}

const Ctx = createContext<InventoryCtx | null>(null);

function cardKey(setId: string, number: string) {
  return `${setId}::${number}`;
}

export function useInventory(): InventoryCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInventory must be used inside InventoryProvider");
  return v;
}

export default function InventoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [collection, setCollection] = useState<CollectionMap>({});
  const [signInOpen, setSignInOpen] = useState(false);

  // Track in-flight rollback snapshots per (setId, number, variant) so a
  // failed adjust restores the right value even if multiple are pending.
  const rollbackRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const supabase = createClient();

    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setSignedIn(!!user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = !!session?.user;
      setSignedIn(next);
      if (!next) setCollection({});
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/collection")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const map: CollectionMap = {};
        for (const item of data.items as Array<{
          setId: string;
          number: string;
          variant: CollectionVariantKey;
          quantity: number;
        }>) {
          const k = cardKey(item.setId, item.number);
          if (!map[k]) map[k] = {};
          map[k][item.variant] = item.quantity;
        }
        setCollection(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const totalFor = useCallback(
    (setId: string, number: string) => {
      const v = collection[cardKey(setId, number)];
      if (!v) return 0;
      let n = 0;
      for (const key of Object.keys(v) as CollectionVariantKey[]) {
        n += v[key] ?? 0;
      }
      return n;
    },
    [collection],
  );

  const presentVariants = useCallback(
    (setId: string, number: string): CollectionVariantKey[] => {
      const v = collection[cardKey(setId, number)];
      if (!v) return [];
      // Every owned key, not a fixed list — the vocabulary is now the full
      // printing grammar, so exotic finishes must survive this filter.
      return Object.keys(v)
        .filter((k) => (v[k] ?? 0) > 0)
        .sort(compareVariants);
    },
    [collection],
  );

  const ownedVariants = useMemo(() => {
    const seen = new Set<string>();
    for (const variants of Object.values(collection)) {
      for (const [key, qty] of Object.entries(variants)) {
        if ((qty ?? 0) > 0) seen.add(key);
      }
    }
    return Array.from(seen).sort(compareVariants);
  }, [collection]);

  const adjust = useCallback(
    async (
      setId: string,
      number: string,
      variant: CollectionVariantKey,
      delta: number,
    ) => {
      if (signedIn === null) return;
      if (signedIn === false) {
        setSignInOpen(true);
        return;
      }
      const k = cardKey(setId, number);
      const snapshotKey = `${k}::${variant}`;
      let snapshot = 0;
      let optimistic = 0;

      setCollection((prev) => {
        const cur = prev[k]?.[variant] ?? 0;
        snapshot = cur;
        optimistic = Math.max(0, cur + delta);
        if (optimistic === cur) return prev;
        rollbackRef.current.set(snapshotKey, cur);
        const variants = { ...(prev[k] ?? {}) };
        if (optimistic === 0) {
          delete variants[variant];
        } else {
          variants[variant] = optimistic;
        }
        const nextCard = Object.keys(variants).length ? variants : undefined;
        const next: CollectionMap = { ...prev };
        if (nextCard) next[k] = nextCard;
        else delete next[k];
        return next;
      });

      if (optimistic === snapshot) return;

      try {
        const res = await fetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId, number, variant, delta }),
        });
        if (!res.ok) throw new Error("server rejected adjust");
        const { quantity } = (await res.json()) as { quantity: number };
        rollbackRef.current.delete(snapshotKey);
        // Reconcile with the server value in case clamping disagreed.
        setCollection((prev) => {
          const variants = { ...(prev[k] ?? {}) };
          if (quantity <= 0) {
            delete variants[variant];
          } else {
            variants[variant] = quantity;
          }
          const next: CollectionMap = { ...prev };
          if (Object.keys(variants).length) next[k] = variants;
          else delete next[k];
          return next;
        });
      } catch {
        const restore = rollbackRef.current.get(snapshotKey) ?? snapshot;
        rollbackRef.current.delete(snapshotKey);
        setCollection((prev) => {
          const variants = { ...(prev[k] ?? {}) };
          if (restore <= 0) delete variants[variant];
          else variants[variant] = restore;
          const next: CollectionMap = { ...prev };
          if (Object.keys(variants).length) next[k] = variants;
          else delete next[k];
          return next;
        });
      }
    },
    [signedIn],
  );

  const value = useMemo<InventoryCtx>(
    () => ({
      signedIn,
      collection,
      totalFor,
      presentVariants,
      ownedVariants,
      adjust,
      promptSignIn: () => setSignInOpen(true),
    }),
    [signedIn, collection, totalFor, presentVariants, ownedVariants, adjust],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {signInOpen && <SignInPrompt onClose={() => setSignInOpen(false)} />}
    </Ctx.Provider>
  );
}

function SignInPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-surface-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-primary">Sign in to track your collection</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Signed-in trainers can track which cards and variants they own. Sign in to start your inventory.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-black/10 bg-white dark:bg-surface-2 hover:bg-surface"
          >
            Not now
          </button>
          <a
            href="/sign-in"
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-black dark:bg-white text-white dark:text-black border border-transparent"
          >
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
