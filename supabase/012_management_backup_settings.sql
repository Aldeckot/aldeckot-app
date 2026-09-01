-- ALDECKOT | Backup automático da Gestão TI
-- Execute após 011_management_backups.sql.

alter table public.management_backups
  drop constraint if exists management_backups_source_check;

alter table public.management_backups
  add constraint management_backups_source_check
  check (source in ('local', 'network', 'automatic'));

create table if not exists public.management_backup_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  automatic boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists management_backup_settings_set_updated_at on public.management_backup_settings;
create trigger management_backup_settings_set_updated_at
  before update on public.management_backup_settings
  for each row execute procedure app.set_updated_at();

alter table public.management_backup_settings enable row level security;

drop policy if exists "Management backup settings are private" on public.management_backup_settings;
create policy "Management backup settings are private" on public.management_backup_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.management_backup_settings to authenticated;
