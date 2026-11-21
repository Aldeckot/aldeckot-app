-- Agenda retention runs only from the database scheduler; opening Home is read-only.
begin;

create table if not exists public.agenda_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  affected_count integer not null default 0 check (affected_count >= 0),
  result text not null check (result in ('success', 'failed')),
  error_message text
);
alter table public.agenda_cleanup_runs enable row level security;
revoke all on public.agenda_cleanup_runs from public, anon, authenticated;

create or replace function public.purge_expired_agenda_entries()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  purged_count integer;
begin
  begin
    delete from public.agenda_entries
    where kind in ('event', 'task')
      and (((created_at at time zone 'America/Sao_Paulo')::date + interval '2 months')::date)
        <= (timezone('America/Sao_Paulo', now()))::date;
    get diagnostics purged_count = row_count;
  exception when others then
    insert into public.agenda_cleanup_runs(result, error_message)
      values ('failed', left(sqlerrm, 1000));
    raise warning 'Agenda retention failed: %', sqlerrm;
    return 0;
  end;
  insert into public.agenda_cleanup_runs(result, affected_count)
    values ('success', purged_count);
  return purged_count;
end $$;

revoke all on function public.purge_expired_agenda_entries() from public, anon, authenticated;
-- The pg_cron job installed by migration 027 calls this replacement function.
-- If pg_cron is absent, an operator must schedule this function using a trusted role.
commit;
