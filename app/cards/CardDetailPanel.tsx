import type { ReactNode } from "react";
import type { CardIndexEntry, RawCard } from "@/lib/cardsIndex";
import { cardImageLarge } from "@/lib/cardImages";
import { pokemonSlug } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";
import { shade } from "@/lib/color";
import { typeIconUrl } from "@/lib/typeIcon";
import CardImage from "./CardImage";

interface Props {
  card: CardIndexEntry;
  raw: RawCard;
  /** Optional element rendered inline in the title row (e.g. Add to list). */
  titleAction?: ReactNode;
}

/**
 * The card image + title/avatar + stat grid + Abilities/Attacks/Rules
 * panels — the 2-column hero block from the card detail page
 * (/cards/[id]), minus the "Appears in" carousel and the "More
 * <Pokemon>" / "More by <Artist>" grids that follow it there. Shared so
 * the home page's catalog preview can show the same panels for a single
 * spotlighted card without duplicating the markup.
 */
export default function CardDetailPanel({ card, raw, titleAction }: Props) {
  const isPokemon = card.supertype === "Pokémon";
  const fullCardNumber = `${card.numberPadded}/${String(card.setSize).padStart(3, "0")}`;
  const avatarSlug = isPokemon ? pokemonSlug(card.name) : null;
  const avatarUrl = avatarSlug
    ? `https://r2.limitlesstcg.net/pokemon/gen9/${avatarSlug}.png`
    : null;
  const avatarColor = typeColor(card.types);
  const avatarBg = `linear-gradient(180deg, ${avatarColor} 0%, ${shade(avatarColor, -22)} 100%)`;

  return (
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
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{card.name}</h1>
            <p className="text-sm text-text-secondary mt-1">
              {card.setName}
              {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {fullCardNumber}
            </p>
          </div>
          {titleAction}
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
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-text-primary">{card.name}</h1>
            <p className="text-sm text-text-secondary mt-1">
              {card.setName}
              {card.ptcgoCode ? ` · ${card.ptcgoCode}` : ""} · {fullCardNumber}
            </p>
          </div>
          {titleAction}
        </div>

        <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-base">
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
                        a.cost.map((c, j) => <TypeIcon key={j} type={c} size={23} />)
                      ) : (
                        <span className="text-sm font-normal text-text-muted">No cost</span>
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
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated p-4 space-y-3">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </div>
  );
}
