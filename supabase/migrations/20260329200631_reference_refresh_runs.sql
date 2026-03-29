create table public.reference_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  status text not null,
  request_params jsonb,
  results jsonb,
  error_text text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_refresh_runs_status_check
    check (status in ('running', 'success', 'partial_success', 'failed'))
);

create index reference_refresh_runs_scope_idx
  on public.reference_refresh_runs (scope, started_at desc);

create trigger reference_refresh_runs_set_updated_at
before update on public.reference_refresh_runs
for each row
execute function public.set_updated_at();
