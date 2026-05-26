interface Props {
  setCode: string | null;
  setId: string;
  number: string;
  setSize: number;
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
}: Props) {
  const code = (setCode || setId).toUpperCase();
  const num = padNumber(number);
  const numberLabel = setSize > 0 ? `${num}/${setSize}` : num;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[15%] min-h-[36px] flex items-end justify-between gap-2 px-2 pb-[5px] bg-gradient-to-b from-transparent to-neutral-800 to-80% text-white text-[12.5px] font-semibold leading-none tabular-nums overflow-hidden">
      <span className="flex items-center min-w-0 mb-[3px]">
        <span className="truncate rounded-md border border-white/70 px-0.5 py-0.5">{code}</span>
      </span>
      <span className="truncate mb-[3px]">{numberLabel}</span>
    </div>
  );
}
