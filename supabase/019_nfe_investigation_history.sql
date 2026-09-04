-- ALDECKOT | Histórico de investigações Fiscal NF-e
-- Execute após 018_fiscal_nfe.sql no SQL Editor do Supabase.
-- Mantém o registro original da NF-e e audita cada solução aplicada.

begin;

create table if not exists public.nfe_investigation_resolutions (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null unique references public.nfe_occurrences(id) on delete cascade,
  solution text not null check (char_length(btrim(solution)) between 3 and 5000),
  pc_replacement boolean not null,
  nfe_paid_pos boolean not null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists nfe_investigation_resolutions_resolved_at_idx
  on public.nfe_investigation_resolutions (resolved_at desc);

create or replace function app.touch_nfe_investigation_resolution()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function app.audit_nfe_investigation_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.nfe_occurrence_logs (occurrence_id, actor_id, action, details)
  values (
    new.occurrence_id,
    auth.uid(),
    'investigation_resolved',
    jsonb_build_object(
      'resolutionId', new.id,
      'pcReplacement', new.pc_replacement,
      'nfePaidPos', new.nfe_paid_pos,
      'resolvedAt', new.resolved_at
    )
  );
  return new;
end;
$$;

alter table public.nfe_occurrence_logs drop constraint if exists nfe_occurrence_logs_action_check;
alter table public.nfe_occurrence_logs add constraint nfe_occurrence_logs_action_check
  check (action in ('created', 'updated', 'deleted', 'investigation_resolved'));

drop trigger if exists nfe_investigation_resolutions_touch on public.nfe_investigation_resolutions;
create trigger nfe_investigation_resolutions_touch
  before update on public.nfe_investigation_resolutions
  for each row execute procedure app.touch_nfe_investigation_resolution();

drop trigger if exists nfe_investigation_resolutions_audit on public.nfe_investigation_resolutions;
create trigger nfe_investigation_resolutions_audit
  after insert or update on public.nfe_investigation_resolutions
  for each row execute procedure app.audit_nfe_investigation_resolution();

alter table public.nfe_investigation_resolutions enable row level security;
revoke all on public.nfe_investigation_resolutions from anon;
grant select, insert, update, delete on public.nfe_investigation_resolutions to authenticated;

drop policy if exists "Contas ativas consultam soluções de investigação NF-e" on public.nfe_investigation_resolutions;
drop policy if exists "Administradores gerenciam soluções de investigação NF-e" on public.nfe_investigation_resolutions;
create policy "Contas ativas consultam soluções de investigação NF-e"
  on public.nfe_investigation_resolutions for select to authenticated
  using (app.has_active_account());
create policy "Administradores gerenciam soluções de investigação NF-e"
  on public.nfe_investigation_resolutions for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

alter table public.nfe_investigation_resolutions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nfe_investigation_resolutions'
  ) then
    alter publication supabase_realtime add table public.nfe_investigation_resolutions;
  end if;
end;
$$;

commit;
