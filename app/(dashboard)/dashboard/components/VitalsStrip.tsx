import type { DevData } from "../lib/github";
import type { OpsData } from "../lib/ops";
import type { ProductData } from "../lib/product";
import type { DeploysData } from "../lib/vercel-deploys";
import { links } from "../lib/links";
import { Sparkline, relTime } from "./Card";

type Maybe<T> = T | { error: string };

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-rose-500",
};

const DEPLOY_TONE: Record<string, string> = {
  READY: "bg-emerald-500",
  ERROR: "bg-rose-500",
  BUILDING: "bg-sky-500",
  QUEUED: "bg-amber-500",
  CANCELED: "bg-gray-400",
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
      className="group relative flex flex-col justify-between rounded-xl border border-black/8 bg-white p-2.5 shadow-sm transition hover:border-black/25 hover:shadow sm:p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </span>
        {accent}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold tabular-nums leading-none text-[var(--text-primary)] sm:text-xl">
            {value}
          </div>
          {hint ? (
            <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
              {hint}
            </div>
          ) : null}
        </div>
        {children}
      </div>
      <span className="pointer-events-none absolute right-2.5 top-2.5 text-[10px] text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100">
        ↗
      </span>
    </a>
  );
}

export default function VitalsStrip({
  ops,
  dev,
  product,
  deploys,
}: {
  ops: Maybe<OpsData>;
  dev: Maybe<DevData>;
  product: Maybe<ProductData>;
  deploys: DeploysData;
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
            <span className="ml-1.5 text-sm font-normal text-[var(--text-secondary)] tabular-nums">
              {l.passed}/{l.passed + l.failed}
            </span>
          </span>
        }
        hint={`${relTime(l.finished_at)} · ${Math.round(Number(l.total_seconds))}s`}
        accent={<span className={`h-2 w-2 rounded-full ${tone}`} />}
      />
    );
  })();

  // --- Deploys vital
  const deploysTile = (() => {
    if (!deploys.available) {
      return (
        <Tile
          href={links.vercel.deployments()}
          label="Last deploy"
          value="—"
          hint={deploys.reason}
          accent={<span className="h-2 w-2 rounded-full bg-gray-300" />}
        />
      );
    }
    const latest = deploys.deploys[0];
    if (!latest) {
      return (
        <Tile
          href={links.vercel.deployments()}
          label="Last deploy"
          value="—"
          hint="No deploys"
        />
      );
    }
    const tone = DEPLOY_TONE[latest.state] ?? "bg-gray-400";
    const branch = latest.branch ?? "—";
    return (
      <Tile
        href={latest.inspectorUrl}
        label="Last deploy"
        value={
          <span className="capitalize">
            {latest.state.toLowerCase()}
            {latest.durationSec != null ? (
              <span className="ml-1.5 text-sm font-normal text-[var(--text-secondary)] tabular-nums">
                {latest.durationSec}s
              </span>
            ) : null}
          </span>
        }
        hint={`${branch} · ${relTime(new Date(latest.createdAt).toISOString())}`}
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
        hint={`${product.users.total} total`}
      >
        <Sparkline values={series} width={64} height={24} />
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
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {opsTile}
      {deploysTile}
      {issuesTile}
      {prsTile}
      {signupsTile}
      {visitorsTile}
    </div>
  );
}
