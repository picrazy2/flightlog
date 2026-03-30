create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_refresh_reference_data(
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
    url := project_url || '/functions/v1/refresh-reference-data',
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

comment on function public.invoke_refresh_reference_data(jsonb) is
  'Invokes the refresh-reference-data Edge Function using Vault-managed project_url and edge_function_secret.';

create or replace function public.sync_reference_refresh_schedule(
  max_aircraft_type_page integer default 100,
  aircraft_type_chunk_size integer default 5,
  aircraft_type_interval_minutes integer default 5
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  job record;
  chunk_start integer := 1;
  chunk_end integer;
  offset_minutes integer := aircraft_type_interval_minutes;
  schedule_hour integer;
  schedule_minute integer;
  job_name text;
  schedule_text text;
  command_text text;
begin
  if max_aircraft_type_page < 1 then
    raise exception 'max_aircraft_type_page must be >= 1';
  end if;

  if aircraft_type_chunk_size < 1 then
    raise exception 'aircraft_type_chunk_size must be >= 1';
  end if;

  if aircraft_type_interval_minutes < 1 then
    raise exception 'aircraft_type_interval_minutes must be >= 1';
  end if;

  for job in
    select jobid
    from cron.job
    where jobname like 'refresh-reference-data-quarterly-%'
  loop
    perform cron.unschedule(job.jobid);
  end loop;

  perform cron.schedule(
    'refresh-reference-data-quarterly-baseline',
    '0 3 1 1,4,7,10 *',
    $job$
      select public.invoke_refresh_reference_data('{"scope":"all"}'::jsonb);
    $job$
  );

  while chunk_start <= max_aircraft_type_page loop
    chunk_end := least(chunk_start + aircraft_type_chunk_size - 1, max_aircraft_type_page);
    schedule_hour := 3 + (offset_minutes / 60);
    schedule_minute := offset_minutes % 60;
    job_name := format(
      'refresh-reference-data-quarterly-aircraft-types-%s-%s',
      lpad(chunk_start::text, 3, '0'),
      lpad(chunk_end::text, 3, '0')
    );
    schedule_text := format('%s %s 1 1,4,7,10 *', schedule_minute, schedule_hour);
    command_text := format(
      $cmd$
        select public.invoke_refresh_reference_data(
          '{"scope":"aircraft_types","page_from":%s,"page_to":%s}'::jsonb
        );
      $cmd$,
      chunk_start,
      chunk_end
    );

    perform cron.schedule(job_name, schedule_text, command_text);

    chunk_start := chunk_end + 1;
    offset_minutes := offset_minutes + aircraft_type_interval_minutes;
  end loop;
end;
$$;

comment on function public.sync_reference_refresh_schedule(integer, integer, integer) is
  'Rebuilds the quarterly refresh-reference-data pg_cron jobs for the baseline scope and aircraft_types chunks.';

select public.sync_reference_refresh_schedule(100, 5, 5);
