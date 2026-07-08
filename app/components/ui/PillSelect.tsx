// Native <select> renders its own dropdown chrome on desktop, which
// overrides border-radius on the trailing edge — the same `rounded-full`
// that shows as a capsule on mobile reads as a rounded rect on desktop.
// `appearance-none` strips the native widget so the pill shape holds; a
// pointer-events-none chevron is painted over the right padding to keep
// the affordance.
export default function PillSelect({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={onChange}
        className="appearance-none w-full text-xs font-semibold h-[38px] pl-3 pr-7 rounded-full border border-black/10 bg-white"
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-secondary"
      >
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </div>
  );
}
