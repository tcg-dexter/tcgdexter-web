import type { DevData } from "../lib/github";
import type { OpsData } from "../lib/ops";
import type { ProductData } from "../lib/product";
import type { DeploysData } from "../lib/vercel-deploys";
import type { BehaviorData } from "../lib/analytics";
import { links } from "../lib/links";
import { Delta, Sparkline, relTime } from "./Card";

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
  delta,
  spark,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: React.ReactNode;
  delta?: React.ReactNode;
  spark?: React.ReactNode;
}) {
  // Flat tiles: no card background, no rounded shell. KPIs sit directly on
  // the page bg and are separated from siblings by grid gap only. A subtle
  // hover affordance (text colour shift) keeps them feeling clickable.
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className="group relative flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </span>
        {accent}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate bg-gradient-to-b from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-2xl font-semibold tracking-tight tabular-nums leading-none text-transparent transition-[background-image] duration-200 group-hover:from-accent group-hover:to-accent-dark sm:text-[28px]">
            {value}
          </div>
          {hint || delta ? (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              {delta}
              {hint ? <span className="truncate">{hint}</span> : null}
            </div>
          ) : null}
        </div>
        {spark ? <div className="shrink-0 opacity-90">{spark}</div> : null}
      </div>
      <span className="pointer-events-none absolute right-0 top-0 text-[10px] text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100">
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
  behavior,
}: {
  ops: Maybe<OpsData>;
  dev: Maybe<DevData>;
  product: Maybe<ProductData>;
  deploys: DeploysData;
  behavior: Maybe<BehaviorData>;
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
          accent={<span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-white/20" />}
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
        accent={
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone} opacity-50`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
          </span>
        }
      />
    );
  })();

  // --- Deploys vital
  const deploysTile = (() => {
    if (!deploys.available) return null;
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
        accent={
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone} opacity-50`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
          </span>
        }
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
      return <Tile href={links.github.prs} label="Open PRs" value="—" hint="—" />;
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
    const prev7 = product.users.signups30d.slice(-14, -7).reduce((a, b) => a + b.count, 0);
    const deltaVal = product.users.newLast7d - prev7;
    return (
      <Tile
        href={links.supabase.auth}
        label="Signups · 7d"
        value={product.users.newLast7d}
        hint={`${product.users.total} total`}
        delta={<Delta value={deltaVal} />}
        spark={<Sparkline values={series} width={64} height={28} stroke="#10b981" />}
      />
    );
  })();

  // --- Active users 7d (from our in-house behavior analytics, replacing the
  // Vercel visitors tile)
  const activeTile = (() => {
    if ("error" in behavior) {
      return (
        <Tile
          href="/dashboard/analytics?window=7"
          label="Active · 7d"
          value="—"
          hint="fetch failed"
        />
      );
    }
    const { activeUsers, firstVsReturning } = behavior;
    const returning = firstVsReturning.returningSessionUsers;
    return (
      <Tile
        href="/dashboard/analytics?window=7"
        label="Active · 7d"
        value={activeUsers}
        hint={`${returning} returning`}
      />
    );
  })();

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
      {opsTile}
      {deploysTile}
      {issuesTile}
      {prsTile}
      {signupsTile}
      {activeTile}
    </div>
  );
}
