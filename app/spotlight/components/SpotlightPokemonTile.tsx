import { pokemonSlug } from "@/lib/primaryCardImage";
import type { SpotlightPokemonRef } from "../types";

const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

interface Props {
  label: string;
  pokemon: SpotlightPokemonRef | null;
}

/**
 * Pokémon "avatar" tile — sprite + name, no set/number metadata. Mirrors
 * the visual weight of SpotlightCardTile so all three favorites read as
 * one row, while making the Pokémon's identity feel character-first
 * rather than card-first.
 */
export default function SpotlightPokemonTile({ label, pokemon }: Props) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm flex flex-col items-center text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">
        {label}
      </div>
      {pokemon ? (
        <>
          <div className="w-full aspect-[5/7] rounded-lg bg-[var(--surface)] flex items-center justify-center mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${SPRITE_BASE}/${pokemonSlug(pokemon.name)}.png`}
              alt={pokemon.name}
              className="w-3/4 h-3/4 object-contain"
              loading="lazy"
            />
          </div>
          <div className="text-sm font-semibold text-text-primary leading-tight">
            {pokemon.name}
          </div>
        </>
      ) : (
        <div className="w-full aspect-[5/7] rounded-lg bg-[var(--surface)] flex items-center justify-center text-xs text-text-muted">
          Not set
        </div>
      )}
    </div>
  );
}
