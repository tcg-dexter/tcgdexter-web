import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readRegistry, type MlRegistryModel } from "@/lib/ml/registry";
import CoachPanel from "./CoachPanel";
import SimulatePanel from "./SimulatePanel";

export const metadata: Metadata = {
  title: "ML Pipeline · Admin Tools",
};

export const dynamic = "force-dynamic";

interface MlRunRow {
  id: number;
  run_date: string;
  run_type: "export" | "train" | "eval" | "promote";
  started_at: string;
  finished_at: string;
  status: "ok" | "partial" | "failed";
  data_hash: string | null;
  parser_version: number | null;
  engine_version: number | null;
  row_counts: Record<string, number> | null;
  n_samples: number | null;
  model_version: string | null;
  metrics: Record<string, unknown> | null;
  promoted: boolean;
  inserted_at: string;
}

const STATUS_STYLES: Record<MlRunRow["status"], string> = {
  ok: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
};

function formatDuration(startedAt: string, finishedAt: string): string {
  const seconds = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${(seconds / 60).toFixed(1)}m`;
}

function totalRows(rowCounts: Record<string, number> | null): number | null {
  if (!rowCounts) return null;
  return Object.values(rowCounts).reduce((sum, n) => sum + n, 0);
}

function ModelCard({ name, model }: { name: string; model: MlRegistryModel }) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-primary">{name}</div>
        <div className="flex gap-1">
          {model.enabled ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
              enabled
            </span>
          ) : model.gated ? (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-800">
              gated
            </span>
          ) : (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-muted">
              off
            </span>
          )}
        </div>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-text-secondary">
        <div className="flex justify-between">
          <dt>Version</dt>
          <dd className="font-mono">{model.model_version}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Trained</dt>
          <dd>{new Date(model.trained_at).toLocaleDateString()}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Samples</dt>
          <dd>{model.n_samples}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Data hash</dt>
          <dd className="font-mono">{model.data_hash.replace(/^sha256:/, "").slice(0, 12)}</dd>
        </div>
        {Object.entries(model.metrics).map(([key, value]) => (
          <div key={key} className="flex justify-between">
            <dt>{key}</dt>
            <dd className="font-mono">{value === null ? "—" : value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function MlPipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) redirect("/");

  const registry = readRegistry();

  // ml_runs is RLS-enabled with no policies (service-role only by design) —
  // reads must go through the admin client after the gate above.
  const admin = createAdminClient();
  const { data: runRows } = await admin
    .from("ml_runs")
    .select(
      "id, run_date, run_type, started_at, finished_at, status, data_hash, parser_version, engine_version, row_counts, n_samples, model_version, metrics, promoted, inserted_at",
    )
    .order("inserted_at", { ascending: false })
    .limit(50);
  const runs = (runRows ?? []) as MlRunRow[];

  // The coach analyzes the caller's OWN matches (user client → RLS-scoped),
  // matching the admin-gated-but-owner-only contract of /api/coach.
  const { data: coachMatches } = await supabase
    .from("matches")
    .select("id, played_at, opponent_archetype, result")
    .not("battle_log_raw", "is", null)
    .order("played_at", { ascending: false })
    .limit(25);

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">ML Pipeline</h1>
          <p className="text-sm text-text-secondary mt-1">
            Training runs, data exports, and the model registry from dexter-ml.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Model Registry
          </h2>
          {registry && Object.keys(registry.models).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(registry.models).map(([name, model]) => (
                <ModelCard key={name} name={name} model={model} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted">
              No model artifacts yet — the registry appears after the first
              training run publishes to data/ml/registry.json.
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Coach Preview
          </h2>
          <CoachPanel matches={coachMatches ?? []} />
        </section>

        <section className="mb-8">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Deck-vs-Deck Simulator
          </h2>
          <SimulatePanel />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Run History
          </h2>
          {runs.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-black/8 bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-black/8 text-left text-text-muted">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Rows</th>
                    <th className="px-3 py-2 font-medium">Data hash</th>
                    <th className="px-3 py-2 font-medium">P/E ver</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const changed = run.metrics?.changed;
                    const goldenVerified = run.metrics?.golden_verified;
                    return (
                      <tr key={run.id} className="border-b border-black/4 last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap text-text-secondary">
                          {run.run_date}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-surface px-2 py-0.5 font-semibold text-text-secondary">
                            {run.run_type}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLES[run.status]}`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {totalRows(run.row_counts)?.toLocaleString() ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-text-muted">
                          {run.data_hash ? run.data_hash.slice(0, 10) : "—"}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {run.parser_version ?? "—"}/{run.engine_version ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {formatDuration(run.started_at, run.finished_at)}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {[
                            changed === false && "no change",
                            changed === true && "snapshot updated",
                            goldenVerified === true && "golden ✓",
                            goldenVerified === false && "golden ✗",
                            run.promoted && "promoted",
                            run.model_version,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-black/15 bg-surface p-6 text-center text-sm text-text-muted">
              No training runs yet — run dexter-ml&apos;s export
              (run_ml_export.command) to populate this.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
