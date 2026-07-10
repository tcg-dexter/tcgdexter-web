import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeDeckList,
  detectDeckArchetype,
  type AnalysisResult,
} from "@/lib/analyzeDeck";
import { parseDeckListCards } from "@/lib/cardPrinting";

/**
 * Server-side helpers for the deck version-control model. A saved deck is
 * the stable "repo" row; deck_versions holds its linear history. Every
 * content write goes through the create_deck_version() Postgres function
 * (via commitDeckVersion below) so the version row and the latest-content
 * mirror on saved_decks stay in sync atomically.
 */

export interface DeckVersionRow {
  id: string;
  deck_id: string;
  version_number: number;
  name: string | null;
  changelog: string;
  deck_list: string;
  analysis: AnalysisResult | null;
  created_at: string;
}

/** Columns for version-list payloads — deliberately no deck_list/analysis,
 *  which are only fetched one version at a time. */
export const VERSION_SUMMARY_COLUMNS =
  "id, deck_id, version_number, name, changelog, created_at";

export type DeckVersionSummary = Omit<
  DeckVersionRow,
  "deck_list" | "analysis"
>;

/**
 * Two deck lists are the same save state when they parse to the same card
 * multiset (name + printing + qty), regardless of line order, wrapping, or
 * comment noise. Used as the no-op guard: identical saves create no
 * version.
 */
export function sameDeckList(a: string, b: string): boolean {
  const key = (list: string) => {
    const counts = new Map<string, number>();
    for (const c of parseDeckListCards(list)) {
      const k = `${c.section}|${c.name.toLowerCase()}|${c.setCode}|${c.number}`;
      counts.set(k, (counts.get(k) ?? 0) + c.qty);
    }
    return counts;
  };
  const ka = key(a);
  const kb = key(b);
  if (ka.size !== kb.size) return false;
  let same = true;
  ka.forEach((qty, k) => {
    if (kb.get(k) !== qty) same = false;
  });
  return same;
}

export async function latestDeckVersion(
  supabase: SupabaseClient,
  deckId: string,
): Promise<DeckVersionRow | null> {
  const { data } = await supabase
    .from("deck_versions")
    .select("*")
    .eq("deck_id", deckId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DeckVersionRow | null) ?? null;
}

export interface CommitResult {
  /** false when the no-op guard matched and no version was created. */
  created: boolean;
  version: DeckVersionRow;
  analysis: AnalysisResult;
  /** Set when the freshly detected archetype differs from the deck's stored
   *  identity — surfaced to the owner as a suggestion, never auto-applied.
   *  `current` carries the stored identity so "keep as is" can be persisted
   *  as an explicit manual choice. */
  archetypeSuggestion?: {
    archetypeId: string | null;
    archetypeName: string;
    current: { archetypeId: string | null; archetypeName: string | null };
  };
}

/**
 * Commit a new version of a deck: analyze server-side (the client-supplied
 * snapshot is never trusted), skip when the list is unchanged, otherwise
 * call the atomic create_deck_version() RPC. Throws DeckParseError for
 * unparseable lists; RLS inside the RPC rejects non-owners.
 *
 * When the deck has no versions yet (created before the backfill window or
 * mid-transition), the commit simply becomes its v1.
 */
export async function commitDeckVersion(
  supabase: SupabaseClient,
  opts: {
    deckId: string;
    deckList: string;
    name?: string | null;
    changelog?: string | null;
    /** Stored archetype identity of the deck, for drift detection. Pass
     *  null fields for decks with no identity yet. */
    currentArchetype?: { id: string | null; name: string | null };
  },
): Promise<CommitResult> {
  const analysis = analyzeDeckList(opts.deckList);

  const latest = await latestDeckVersion(supabase, opts.deckId);
  if (latest && sameDeckList(latest.deck_list, opts.deckList)) {
    return { created: false, version: latest, analysis };
  }

  const { data, error } = await supabase.rpc("create_deck_version", {
    p_deck_id: opts.deckId,
    p_deck_list: opts.deckList,
    p_analysis: analysis,
    p_name: opts.name ?? null,
    p_changelog: opts.changelog ?? "",
  });

  if (error || !data) {
    throw new Error(error?.message ?? "create_deck_version returned nothing");
  }

  const version = data as DeckVersionRow;
  const result: CommitResult = { created: true, version, analysis };

  if (opts.currentArchetype) {
    const detected = detectDeckArchetype(analysis);
    if (
      detected.archetypeName &&
      (detected.archetypeId ?? null) !== (opts.currentArchetype.id ?? null) &&
      detected.archetypeName !== opts.currentArchetype.name
    ) {
      result.archetypeSuggestion = {
        archetypeId: detected.archetypeId,
        archetypeName: detected.archetypeName,
        current: {
          archetypeId: opts.currentArchetype.id ?? null,
          archetypeName: opts.currentArchetype.name ?? null,
        },
      };
    }
  }

  return result;
}
