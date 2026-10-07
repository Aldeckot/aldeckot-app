-- Suprimentos: cópias privadas e frequência independente dos demais módulos.
-- Não altera nem remove dados existentes. Execute após 058_supplies.sql.
begin;

create table if not exists public.supply_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  snapshot jsonb not null,
  source text not null check (source in ('network', 'automatic')),
  created_at timestamptz not null default now()
);
create index if not exists supply_backups_created_idx on public.supply_backups (created_at desc);
alter table public.supply_backups enable row level security;
revoke all on public.supply_backups from anon, authenticated;
grant select, insert, delete on public.supply_backups to authenticated;
drop policy if exists "Contas ativas consultam backups de suprimentos" on public.supply_backups;
drop policy if exists "Administradores criam backups de suprimentos" on public.supply_backups;
drop policy if exists "Administradores removem backups antigos de suprimentos" on public.supply_backups;
create policy "Contas ativas consultam backups de suprimentos" on public.supply_backups for select to authenticated using (app.has_active_account());
create policy "Administradores criam backups de suprimentos" on public.supply_backups for insert to authenticated with check (app.is_admin());
create policy "Administradores removem backups antigos de suprimentos" on public.supply_backups for delete to authenticated using (app.is_admin());

create table if not exists public.supply_backup_settings (
  setting_key text primary key default 'global' check (setting_key = 'global'),
  automatic boolean not null default false,
  frequency_days integer not null default 7 check (frequency_days between 1 and 90),
  updated_at timestamptz not null default now()
);
alter table public.supply_backup_settings enable row level security;
revoke all on public.supply_backup_settings from anon, authenticated;
grant select, insert, update on public.supply_backup_settings to authenticated;
drop policy if exists "Contas ativas consultam frequência de suprimentos" on public.supply_backup_settings;
drop policy if exists "Administradores inserem frequência de suprimentos" on public.supply_backup_settings;
drop policy if exists "Administradores atualizam frequência de suprimentos" on public.supply_backup_settings;
create policy "Contas ativas consultam frequência de suprimentos" on public.supply_backup_settings for select to authenticated using (app.has_active_account());
create policy "Administradores inserem frequência de suprimentos" on public.supply_backup_settings for insert to authenticated with check (app.is_admin());
create policy "Administradores atualizam frequência de suprimentos" on public.supply_backup_settings for update to authenticated using (app.is_admin()) with check (app.is_admin());
insert into public.supply_backup_settings (setting_key) values ('global') on conflict (setting_key) do nothing;

-- Uma única transação fornece um retrato consistente de todas as tabelas do módulo.
create or replace function public.supply_backup_snapshot() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'application', 'ALDECKOT', 'module', 'supplies', 'version', 1,
    'createdAt', now(),
    'data', jsonb_build_object(
      'supplies', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supplies t),
      'variants', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_variants t),
      'units', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_units t),
      'installations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_installations t),
      'movements', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_movements t),
      'logs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_logs t),
      'maintenanceLinks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.supply_maintenance_links t)
    )
  );
$$;
revoke all on function public.supply_backup_snapshot() from public, anon;
grant execute on function public.supply_backup_snapshot() to authenticated;

commit;
