-- ml_runs: per-run telemetry written by dexter-ml (export/train/eval/promote jobs).
-- Read by the admin dashboard at /admin-tools/ml via the service-role client.
-- RLS enabled with no policies → only service role can read/write (ops_runs idiom).

create table public.ml_runs (
  id             bigserial primary key,
  run_date       date not null,
  run_type       text not null check (run_type in ('export','train','eval','promote')),
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  status         text not null check (status in ('ok','partial','failed')),
  data_hash      text,
  parser_version int,
  engine_version int,
  row_counts     jsonb,
  n_samples      int,
  model_version  text,
  metrics        jsonb,
  artifacts      jsonb,
  promoted       boolean not null default false,
  steps          jsonb,
  log_path       text,
  notes          text,
  inserted_at    timestamptz not null default now()
);
create index ml_runs_run_date_idx on public.ml_runs (run_date desc);
create index ml_runs_type_idx on public.ml_runs (run_type, inserted_at desc);
alter table public.ml_runs enable row level security;
comment on table public.ml_runs is 'Per-run telemetry written by dexter-ml. Service-role only (RLS, no policies).';
