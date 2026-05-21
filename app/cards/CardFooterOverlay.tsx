interface Props {
  setCode: string | null;
  setId: string;
  number: string;
  setSize: number;
  marketPrice: number;
}

function formatPrice(p: number): string {
  if (!p || p <= 0) return "—";
  if (p >= 1000) return `$${Math.round(p).toLocaleString()}`;
  return `$${p.toFixed(2)}`;
}

function padNumber(n: string): string {
  const m = n.match(/^(\d+)(.*)$/);
  if (!m) return n;
  return m[1].padStart(3, "0") + m[2];
}

export default function CardFooterOverlay({
  setCode,
  setId,
  number,
  setSize,
  marketPrice,
}: Props) {
  const code = (setCode || setId).toUpperCase();
  const num = padNumber(number);
  const numberLabel = setSize > 0 ? `${num}/${setSize}` : num;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[20%] min-h-[48px] flex items-end justify-between gap-2 px-2 pb-1.5 bg-gradient-to-b from-transparent to-black text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden">
      <span className="flex items-end gap-1 min-w-0">
        <span className="truncate">{code}</span>
        <span className="truncate">{numberLabel}</span>
      </span>
      <span className="truncate">{formatPrice(marketPrice)}</span>
    </div>
  );
}
