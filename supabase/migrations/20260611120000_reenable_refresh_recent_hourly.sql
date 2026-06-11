-- Re-enable the hourly refresh-recent cron. Safe to turn back on: the function now
-- marks flights the provider has no record of as 'not_found' so they're never re-queried
-- (no perpetual API spend), and only sends an API query for not-yet-enriched flights
-- that have landed, or recently-flown flights still missing a track (≤14 days).
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
end $$;
