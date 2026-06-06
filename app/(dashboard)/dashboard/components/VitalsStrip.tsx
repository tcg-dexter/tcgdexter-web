import type { DevData } from "../lib/github";
import type { OpsData } from "../lib/ops";
import type { ProductData } from "../lib/product";
import { links } from "../lib/links";
import { Sparkline, relTime } from "./Card";

type Maybe<T> = T | { error: string };

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-rose-500",
};

function Tile({
  href,
  label,
  value,
  hint,
  accent,
  children,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className="group relative flex flex-col justify-between rounded-xl border border-black/8 bg-white p-4 shadow-sm transition hover:border-black/20 hover:shadow"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </span>
        {accent}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none text-[var(--text-primary)]">
            {value}
          </div>
          {hint ? (
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{hint}</div>
          ) : null}
        </div>
        {children}
      </div>
      <span className="pointer-events-none absolute right-3 top-3 text-[10px] text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100">
        ↗
      </span>
    </a>
  );
}

export default function VitalsStrip({
  ops,
  dev,
  product,
}: {
  ops: Maybe<OpsData>;
  dev: Maybe<DevData>;
  product: Maybe<ProductData>;
}) {
  // --- Ops vital
  const opsTile = (() => {
    if ("error" in ops || !ops.latest) {
      return (
        <Tile
          href={links.supabase.table("ops_runs")}
          label="Ops · last run"
          value={<span className="text-[var(--text-muted)]">—</span>}
          hint="Waiting for first run"
          accent={<span className="h-2 w-2 rounded-full bg-gray-300" />}
        />
      );
    }
    const l = ops.latest;
    const tone = STATUS_TONE[l.status] ?? "bg-gray-400";
    return (
      <Tile
        href={links.supabase.table("ops_runs")}
        label="Ops · last run"
        value={
          <span className="capitalize">
            {l.status}
            <span className="ml-2 text-sm font-normal text-[var(--text-secondary)] tabular-nums">
              {l.passed}/{l.passed + l.failed}
            </span>
          </span>
        }
        hint={`${relTime(l.finished_at)} · ${Math.round(Number(l.total_seconds))}s`}
        accent={<span className={`h-2 w-2 rounded-full ${tone}`} />}
      />
    );
  })();

  // --- Open issues
  const issuesTile = (() => {
    if ("error" in dev) {
      return (
        <Tile
          href={links.github.issues}
          label="Open issues"
          value="—"
          hint="GitHub fetch failed"
        />
      );
    }
    return (
      <Tile
        href={links.github.issues}
        label="Open issues"
        value={dev.openIssueCount}
        hint={`across ${dev.repos.length} repos`}
      />
    );
  })();

  // --- Open PRs
  const prsTile = (() => {
    if ("error" in dev) {
      return (
        <Tile href={links.github.prs} label="Open PRs" value="—" hint="—" />
      );
    }
    return (
      <Tile
        href={links.github.prs}
        label="Open PRs"
        value={dev.openPrCount}
        hint={
          dev.recentPrs[0]
            ? `latest ${relTime(dev.recentPrs[0].updatedAt)}`
            : "no recent PRs"
        }
      />
    );
  })();

  // --- Signups 7d
  const signupsTile = (() => {
    if ("error" in product) {
      return <Tile href={links.supabase.auth} label="Signups · 7d" value="—" />;
    }
    const series = product.users.signups30d.slice(-7).map((p) => p.count);
    return (
      <Tile
        href={links.supabase.auth}
        label="Signups · 7d"
        value={product.users.newLast7d}
        hint={`${product.users.total} total users`}
      >
        <Sparkline values={series} width={80} height={28} />
      </Tile>
    );
  })();

  // --- Visitors 7d
  const visitorsTile = (() => {
    if ("error" in product || !product.vercel.available) {
      return (
        <Tile
          href={links.vercel.analytics()}
          label="Visitors · 7d"
          value="—"
          hint={
            "error" in product
              ? "fetch failed"
              : product.vercel.available === false
                ? "analytics offline"
                : ""
          }
        />
      );
    }
    return (
      <Tile
        href={links.vercel.analytics()}
        label="Visitors · 7d"
        value={product.vercel.visitors7d ?? "—"}
        hint={`${product.vercel.visitors30d ?? "—"} in 30d`}
      />
    );
  })();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {opsTile}
      {issuesTile}
      {prsTile}
      {signupsTile}
      {visitorsTile}
    </div>
  );
}
