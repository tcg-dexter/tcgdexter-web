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
import { typeIconUrl } from "@/lib/typeIcon";
import { findCardAppearances } from "@/lib/cardAppearances";
import AppearsInCarousel from "./AppearsInCarousel";

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
  const fullCardNumber = `${card.numberPadded}/${String(card.setSize).padStart(3, "0")}`;
  const avatarSlug = isPokemon ? pokemonSlug(card.name) : null;
  const avatarUrl = avatarSlug
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${avatarSlug}.png`
    : null;
  const avatarColor = typeColor(card.types);
  const avatarBg = `linear-gradient(180deg, ${avatarColor} 0%, ${shade(avatarColor, -22)} 100%)`;

  // First "Appears in" batch (top meta variants containing this exact
  // printing). Server-render the first 10 so the section paints with the
  // page; the client carousel pulls the next batches on scroll.
  const appearancesInitial = findCardAppearances(
    card.ptcgoCode ?? "",
    card.number,
    0,
    10,
  );

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
                {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {fullCardNumber}
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
            noAnimate
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
                {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {fullCardNumber}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-black/8 bg-white p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-base">
            <Stat
              label="Type"
              value={
                card.types.length > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    {card.types.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1.5">
                        <TypeIcon type={t} />
                        <span>{t}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Stat
              label="Weakness"
              value={
                raw.weaknesses && raw.weaknesses.length > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    {raw.weaknesses.map((w, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5">
                        <TypeIcon type={w.type} />
                        <span>
                          {w.type} {w.value}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Stat
              label="Retreat"
              value={
                card.retreatCost > 0 ? (
                  <span className="inline-flex items-center gap-0.5">
                    {Array.from({ length: card.retreatCost }).map((_, i) => (
                      <TypeIcon key={i} type="Colorless" />
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Stat label="HP" value={card.hp != null ? String(card.hp) : "—"} />
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
                  <div className="text-base font-semibold text-text-primary">
                    {a.name}
                    <span className="ml-2 text-sm font-normal text-text-muted">{a.type}</span>
                  </div>
                  <p className="text-base text-text-secondary leading-relaxed">{a.text}</p>
                </div>
              ))}
            </Section>
          )}

          {raw.attacks && raw.attacks.length > 0 && (
            <Section title="Attacks">
              {raw.attacks.map((a, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-base font-semibold text-text-primary flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-0.5 shrink-0 ${
                          a.cost.length > 4 ? "w-[123px]" : "w-[98px]"
                        }`}
                      >
                        {a.cost.length > 0 ? (
                          a.cost.map((c, j) => (
                            <TypeIcon key={j} type={c} size={23} />
                          ))
                        ) : (
                          <span className="text-sm font-normal text-text-muted">
                            No cost
                          </span>
                        )}
                      </span>
                      <span>{a.name}</span>
                    </span>
                    {a.damage && <span className="text-text-primary">{a.damage}</span>}
                  </div>
                  {a.text && (
                    <p className="text-base text-text-secondary leading-relaxed">{a.text}</p>
                  )}
                </div>
              ))}
            </Section>
          )}

          {raw.rules && raw.rules.length > 0 && (
            <Section title="Rules">
              {raw.rules.map((r, i) => (
                <p key={i} className="text-base text-text-secondary leading-relaxed">
                  {r}
                </p>
              ))}
            </Section>
          )}
        </div>
      </div>

      {appearancesInitial.items.length > 0 && (
        <AppearsInCarousel
          setCode={card.ptcgoCode ?? ""}
          number={card.number}
          initialItems={appearancesInitial.items}
          initialHasMore={appearancesInitial.hasMore}
        />
      )}

      {otherPrintings.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            More {card.name}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {otherPrintings.map((c, i) => (
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
                  index={i}
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
            {moreByArtist.map((c, i) => (
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
                  index={i}
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

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </div>
      <div className="text-text-primary font-semibold">{value}</div>
    </div>
  );
}

function TypeIcon({ type, size = 20 }: { type: string; size?: number }) {
  const url = typeIconUrl(type);
  if (!url) return <span>{type}</span>;
  return (
    <img
      src={url}
      alt={type}
      title={type}
      width={size}
      height={size}
      className="inline-block align-[-3px]"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 space-y-3">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </div>
  );
}
