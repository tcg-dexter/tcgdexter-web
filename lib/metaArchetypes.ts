import archetypesRaw from "@/data/meta-archetypes.json";

export interface MetaArchetypeEntry {
  id: string;
  name: string;
  total_entries: number;
  icons?: string;
}

/** The top 30 meta archetypes by total_entries, matching /meta-archetypes. */
export const TOP_META_ARCHETYPES: MetaArchetypeEntry[] = (
  archetypesRaw as MetaArchetypeEntry[]
)
  .slice()
  .sort((a, b) => b.total_entries - a.total_entries)
  .slice(0, 30);

/** Display names of the current top-30 meta archetypes, in /meta-archetypes
 *  order. Used for the match-log archetype autocomplete and the homepage's
 *  opponent-archetype gating. */
export const META_ARCHETYPE_NAMES: string[] = TOP_META_ARCHETYPES.map(
  (a) => a.name,
);
