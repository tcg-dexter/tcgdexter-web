import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCardById,
  getCardsByArtist,
  getCardsByName,
  getRawCard,
} from "@/lib/cardsIndex";
import { cardImageLarge, cardImageSmall } from "@/lib/cardImages";
import BackButton from "@/app/components/ui/BackButton";
import CardImage from "../CardImage";
import { pokemonSlug } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { shade } from "@/lib/color";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const card = getCardById(id);
  if (!card) return { title: "Card — TCG Dexter" };
  return {
    title: `${card.name} (${card.setName} ${card.number}) — TCG Dexter`,
  };
}

export default function CardDetailPage({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const card = getCardById(id);
  const raw = getRawCard(id);
  if (!card || !raw) notFound();

  const isPokemon = card.supertype === "Pokémon";
  const avatarSlug = isPokemon ? pokemonSlug(card.name) : null;
  const avatarUrl = avatarSlug
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${avatarSlug}.png`
    : null;
  const avatarColor = typeColor(card.types);
  const avatarBg = `linear-gradient(180deg, ${avatarColor} 0%, ${shade(avatarColor, -22)} 100%)`;

  const otherPrintings = getCardsByName(card.name).filter((c) => c.id !== card.id);
  // Pull other cards illustrated by the same artist. Cap to ~3 rows at lg
  // (8 cols) so a prolific illustrator's catalog doesn't take over the
  // page. Excludes any printing of the current card so the section sits
  // cleanly alongside "More {name}".
  const moreByArtist = card.artist
    ? getCardsByArtist(card.artist)
        .filter((c) => c.nameLower !== card.nameLower)
        .slice(0, 24)
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] xl:pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-24">
      {/* Desktop-only — back button flushes to the top of the available
          space (matching deck profile pages); on mobile the BackButton
          portals into the sticky toolbar. */}
      <div className="hidden xl:block mb-8">
        <BackButton href="/cards" ariaLabel="Back to Cards" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,400px)_1fr] gap-6">
        <div className="flex flex-col gap-3">
          <div className="md:hidden flex items-center gap-3">
            {isPokemon && (
              <span
                className="w-14 h-14 rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden shadow-md"
                style={{ background: avatarBg }}
                aria-hidden
              >
                {avatarUrl && (
                  <img src={avatarUrl} alt="" className="w-11 h-11 object-contain" />
                )}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-text-primary">{card.name}</h1>
              <p className="text-sm text-text-secondary mt-1">
                {card.setName}
                {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {card.number}
              </p>
            </div>
          </div>
          <CardImage
            src={cardImageLarge(card.setId, card.number)}
            alt={`${card.name} — ${card.setName} ${card.number}`}
            name={card.name}
            setName={card.setName}
            number={card.number}
            loading="eager"
            fetchPriority="high"
            className="w-full rounded-2xl shadow-md bg-surface"
            style={{ aspectRatio: "245 / 342" }}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="hidden md:flex items-center gap-3">
            {isPokemon && (
              <span
                className="w-14 h-14 rounded-full shrink-0 inline-flex items-center justify-center overflow-hidden shadow-md"
                style={{ background: avatarBg }}
                aria-hidden
              >
                {avatarUrl && (
                  <img src={avatarUrl} alt="" className="w-11 h-11 object-contain" />
                )}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-text-primary">{card.name}</h1>
              <p className="text-sm text-text-secondary mt-1">
                {card.setName}
                {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {card.number}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-black/8 bg-white p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Supertype" value={card.supertype} />
            <Stat label="Subtypes" value={card.subtypes.join(", ") || "—"} />
            <Stat label="Type" value={card.types.join(", ") || "—"} />
            <Stat label="HP" value={card.hp != null ? String(card.hp) : "—"} />
            <Stat label="Retreat" value={String(card.retreatCost)} />
            <Stat label="Regulation" value={card.regulationMark ?? "—"} />
            <Stat
              label="Market price"
              value={card.marketPrice > 0 ? `$${card.marketPrice.toFixed(2)}` : "—"}
            />
          </div>

          {raw.abilities && raw.abilities.length > 0 && (
            <Section title="Abilities">
              {raw.abilities.map((a, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-sm font-semibold text-text-primary">
                    {a.name}
                    <span className="ml-2 text-xs font-normal text-text-muted">{a.type}</span>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{a.text}</p>
                </div>
              ))}
            </Section>
          )}

          {raw.attacks && raw.attacks.length > 0 && (
            <Section title="Attacks">
              {raw.attacks.map((a, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-sm font-semibold text-text-primary flex items-center justify-between gap-2">
                    <span>
                      {a.name}
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        {a.cost.join(", ") || "No cost"}
                      </span>
                    </span>
                    {a.damage && <span className="text-text-primary">{a.damage}</span>}
                  </div>
                  {a.text && (
                    <p className="text-sm text-text-secondary leading-relaxed">{a.text}</p>
                  )}
                </div>
              ))}
            </Section>
          )}

          {raw.rules && raw.rules.length > 0 && (
            <Section title="Rules">
              {raw.rules.map((r, i) => (
                <p key={i} className="text-sm text-text-secondary leading-relaxed">
                  {r}
                </p>
              ))}
            </Section>
          )}
        </div>
      </div>

      {otherPrintings.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            More {card.name}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {otherPrintings.map((c) => (
              <Link
                key={c.id}
                href={`/cards/${encodeURIComponent(c.id)}`}
                className="block rounded-lg overflow-hidden bg-surface hover:shadow-md transition-shadow"
                style={{ aspectRatio: "245 / 342" }}
                title={`${c.setName} ${c.number}`}
              >
                <CardImage
                  src={cardImageSmall(c.setId, c.number)}
                  alt={`${c.name} — ${c.setName} ${c.number}`}
                  name={c.name}
                  setName={c.setName}
                  number={c.number}
                  className="w-full h-full object-contain"
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {moreByArtist.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            More by {card.artist}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {moreByArtist.map((c) => (
              <Link
                key={c.id}
                href={`/cards/${encodeURIComponent(c.id)}`}
                className="block rounded-lg overflow-hidden bg-surface hover:shadow-md transition-shadow"
                style={{ aspectRatio: "245 / 342" }}
                title={`${c.name} — ${c.setName} ${c.number}`}
              >
                <CardImage
                  src={cardImageSmall(c.setId, c.number)}
                  alt={`${c.name} — ${c.setName} ${c.number}`}
                  name={c.name}
                  setName={c.setName}
                  number={c.number}
                  className="w-full h-full object-contain"
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </div>
      <div className="text-text-primary">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {children}
    </div>
  );
}
