-- ALDECKOT | Backup completo da Central Fiscal NF-e
-- Execute após 019_nfe_investigation_history.sql no SQL Editor do Supabase.

begin;

alter table public.nfe_backups
  add column if not exists source text not null default 'manual';

alter table public.nfe_backups drop constraint if exists nfe_backups_source_check;
alter table public.nfe_backups add constraint nfe_backups_source_check
  check (source in ('manual', 'automatic'));

create table if not exists public.nfe_backup_settings (
  setting_key text primary key default 'global' check (setting_key = 'global'),
  automatic boolean not null default false,
  frequency_days integer not null default 7 check (frequency_days between 1 and 90),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.touch_nfe_backup_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists nfe_backup_settings_touch on public.nfe_backup_settings;
create trigger nfe_backup_settings_touch
  before update on public.nfe_backup_settings
  for each row execute procedure app.touch_nfe_backup_settings();

insert into public.nfe_backup_settings (setting_key, automatic, frequency_days)
values ('global', false, 7)
on conflict (setting_key) do nothing;

alter table public.nfe_backup_settings enable row level security;
revoke all on public.nfe_backup_settings from anon;
grant select, insert, update, delete on public.nfe_backup_settings to authenticated;

drop policy if exists "Contas ativas consultam configuração de backup NF-e" on public.nfe_backup_settings;
drop policy if exists "Administradores gerenciam configuração de backup NF-e" on public.nfe_backup_settings;
create policy "Contas ativas consultam configuração de backup NF-e"
  on public.nfe_backup_settings for select to authenticated
  using (app.has_active_account());
create policy "Administradores gerenciam configuração de backup NF-e"
  on public.nfe_backup_settings for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

alter table public.nfe_backups replica identity full;
alter table public.nfe_backup_settings replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nfe_backup_settings'
  ) then
    alter publication supabase_realtime add table public.nfe_backup_settings;
  end if;
end;
$$;

commit;
