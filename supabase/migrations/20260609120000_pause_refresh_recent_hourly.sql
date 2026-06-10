-- Pause the hourly refresh-recent cron while AeroAPI Standard backfill is validated.
-- Re-enable later by re-running 20260331110000_schedule_refresh_recent.sql's cron.schedule.
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
end $$;
