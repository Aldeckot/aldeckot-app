-- Enable the supported Supabase scheduler and run audited agenda retention daily.
-- On local PostgreSQL images without pg_cron, leave the job absent and report it.
begin;

do $schedule$
begin
  if to_regclass('public.agenda_cleanup_runs') is null
    or to_regprocedure('public.purge_expired_agenda_entries()') is null then
    raise exception 'Apply migration 110 before scheduling agenda cleanup.';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    execute format(
      'select cron.schedule(%L, %L, %L)',
      'aldeckot-purge-expired-agenda-entries',
      '5 3 * * *',
      'select public.purge_expired_agenda_entries()'
    );
  else
    raise notice 'pg_cron unavailable; schedule agenda cleanup using a trusted external scheduler.';
  end if;
end;
$schedule$;

commit;
