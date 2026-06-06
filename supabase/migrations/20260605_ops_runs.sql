-- ops_runs: end-of-run summary written by dexter-ops/scripts/daily_ops.py.
-- Read by the internal dashboard at dashboard.tcgdexter.com via service-role.
-- RLS enabled with no policies → only service role can read/write.

create table public.ops_runs (
  id            bigserial primary key,
  run_date      date not null,
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  status        text not null check (status in ('ok','partial','failed')),
  passed        int  not null,
  failed        int  not null,
  total_seconds numeric not null,
  steps         jsonb not null,
  log_path      text,
  inserted_at   timestamptz not null default now()
);
create index ops_runs_run_date_idx on public.ops_runs (run_date desc);
alter table public.ops_runs enable row level security;
comment on table public.ops_runs is 'End-of-run summary written by dexter-ops/scripts/daily_ops.py. Service-role only.';
