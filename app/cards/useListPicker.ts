"use client";

import { useEffect, useState } from "react";
import type { ListSummary } from "@/lib/lists";

interface PickerState {
  loading: boolean;
  lists: ListSummary[];
  hasUsername: boolean;
}

interface CreatedList {
  id: string;
  shortId: string;
  name: string;
  isPublic: boolean;
  href: string;
}

/**
 * Shared data layer behind every "add to list" picker (the card detail
 * page's dropdown, the catalog grid tile's in-card overlay): fetches the
 * caller's lists (with per-list `containsCard`) while `active`, and
 * exposes an optimistic toggle against POST/DELETE /api/lists/[id]/items.
 */
export function useListPicker(setId: string, number: string, active: boolean) {
  const [state, setState] = useState<PickerState>({ loading: false, lists: [], hasUsername: true });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/lists?setId=${encodeURIComponent(setId)}&number=${encodeURIComponent(number)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load lists"))))
      .then((data: { lists: ListSummary[]; hasUsername: boolean }) => {
        if (cancelled) return;
        setState({ loading: false, lists: data.lists, hasUsername: data.hasUsername });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, lists: [], hasUsername: true });
      });
    return () => {
      cancelled = true;
    };
  }, [active, setId, number]);

  async function toggle(list: ListSummary) {
    const nextContains = !list.containsCard;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => (l.id === list.id ? { ...l, containsCard: nextContains } : l)),
    }));
    try {
      const url = nextContains
        ? `/api/lists/${list.id}/items`
        : `/api/lists/${list.id}/items?setId=${encodeURIComponent(setId)}&number=${encodeURIComponent(number)}`;
      const res = await fetch(url, {
        method: nextContains ? "POST" : "DELETE",
        ...(nextContains
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ setId, number }),
            }
          : {}),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setState((s) => ({
        ...s,
        lists: s.lists.map((l) => (l.id === list.id ? { ...l, containsCard: !nextContains } : l)),
      }));
    }
  }

  function addCreatedList(created: CreatedList) {
    setState((s) => ({
      ...s,
      lists: [
        {
          id: created.id,
          shortId: created.shortId,
          name: created.name,
          isPublic: created.isPublic,
          itemCount: 1,
          href: created.href,
          previewCards: [{ setId, number }],
          containsCard: true,
        },
        ...s.lists,
      ],
    }));
  }

  return { state, toggle, addCreatedList };
}
