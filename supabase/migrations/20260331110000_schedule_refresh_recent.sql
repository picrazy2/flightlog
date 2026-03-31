create or replace function public.invoke_refresh_recent(
  request_params jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  project_url text;
  edge_function_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'project_url';

  if project_url is null then
    raise exception 'Missing vault secret: project_url';
  end if;

  select decrypted_secret
  into edge_function_secret
  from vault.decrypted_secrets
  where name = 'edge_function_secret';

  if edge_function_secret is null then
    raise exception 'Missing vault secret: edge_function_secret';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/refresh-recent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || edge_function_secret
    ),
    body := request_params,
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.invoke_refresh_recent(jsonb) is
  'Invokes the refresh-recent Edge Function using Vault-managed project_url and edge_function_secret.';

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'refresh-recent-hourly';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'refresh-recent-hourly',
    '0 * * * *',
    $job$
      select public.invoke_refresh_recent('{"limit":50}'::jsonb);
    $job$
  );
end;
$$;
