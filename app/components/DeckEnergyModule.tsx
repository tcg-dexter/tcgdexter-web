import { ENERGY_HEX } from "@/lib/energyColors";

/**
 * Energy distribution — the analyzer already breaks basic energy down by
 * elemental type (`basicByType`) and counts special energy; only the flat
 * total was ever shown. This renders a segmented color bar of the energy
 * split plus a legend and any special-energy names.
 */
interface Props {
  basicByType: Record<string, number>;
  basicCount: number;
  specialCount: number;
  specialDetails: Array<{ name: string; qty: number; description: string }>;
}

/** Neutral swatch for the aggregated special-energy segment. */
const SPECIAL_HEX = "#4a4a4a";

export default function DeckEnergyModule({
  basicByType,
  basicCount,
  specialCount,
  specialDetails,
}: Props) {
  const total = basicCount + specialCount;
  if (total <= 0) return null;

  const segments: Array<{ key: string; label: string; count: number; hex: string }> =
    Object.entries(basicByType)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        key: type,
        label: type,
        count,
        hex: ENERGY_HEX[type] ?? ENERGY_HEX.Colorless,
      }));

  if (specialCount > 0) {
    segments.push({
      key: "__special",
      label: "Special",
      count: specialCount,
      hex: SPECIAL_HEX,
    });
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Energy</h2>
        <span className="text-sm tabular-nums text-text-muted">{total} total</span>
      </div>

      {/* Distribution bar */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-black/5">
        {segments.map((s) => (
          <div
            key={s.key}
            style={{ width: `${(s.count / total) * 100}%`, background: s.hex }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: s.hex }}
            />
            <span className="text-text-secondary">{s.label}</span>
            <span className="font-semibold tabular-nums text-text-primary">
              {s.count}
            </span>
          </div>
        ))}
      </div>

      {/* Special-energy names */}
      {specialDetails.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/5 pt-3">
          {specialDetails.map((sp) => (
            <span
              key={sp.name}
              className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs text-text-secondary"
            >
              <span className="font-semibold tabular-nums">{sp.qty}</span>
              <span>{sp.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
