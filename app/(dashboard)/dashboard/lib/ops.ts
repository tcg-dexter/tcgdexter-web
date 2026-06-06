import { createAdminClient } from "@/lib/supabase/admin";

export type OpsStep = {
  n: number;
  name: string;
  ok: boolean;
  seconds: number;
  note?: string | null;
};

export type OpsRun = {
  id: number;
  run_date: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "partial" | "failed";
  passed: number;
  failed: number;
  total_seconds: number;
  steps: OpsStep[];
  log_path: string | null;
};

export type OpsData = {
  latest: OpsRun | null;
  history: { run_date: string; status: string; total_seconds: number }[];
};

export async function fetchOps(): Promise<OpsData> {
  const admin = createAdminClient();
  const [latest, history] = await Promise.all([
    admin
      .from("ops_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<OpsRun>(),
    admin
      .from("ops_runs")
      .select("run_date,status,total_seconds")
      .order("run_date", { ascending: false })
      .limit(14),
  ]);

  return {
    latest: latest.data ?? null,
    history: (history.data ?? []).slice().reverse(),
  };
}
