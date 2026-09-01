-- ALDECKOT | Esquema inicial do Supabase
-- Execute este arquivo inteiro no SQL Editor do projeto Supabase.
-- A aplicação usa identidades anônimas para manter os dados privados sem
-- exigir uma tela de login. Ative "Anonymous sign-ins" em Authentication > Providers.

create extension if not exists pgcrypto;

create schema if not exists app;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists aldeckot_on_auth_user_created on auth.users;
create trigger aldeckot_on_auth_user_created
  after insert on auth.users
  for each row execute procedure app.create_profile_for_user();

create table if not exists public.module_tables (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text not null check (module in ('inventory', 'control', 'flux', 'nfe')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  icon text not null default '📁' check (char_length(icon) between 1 and 12),
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, module, name)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  equipment text not null check (char_length(btrim(equipment)) between 1 and 160),
  model text not null check (char_length(btrim(model)) between 1 and 160),
  brand text not null default '',
  serial text not null default '',
  tag text not null default '',
  sector text not null default '',
  location text not null default '',
  status text not null default 'Ativo' check (status in ('Ativo', 'Reserva', 'Manutenção', 'Troca', 'Defeito', 'Atenção')),
  situation text not null default 'Normal' check (situation in ('Normal', 'Atenção', 'Substituído', 'Verificando')),
  cleaning_type text not null default 'Não realizada' check (cleaning_type in ('Completa', 'Preventiva', 'Regular', 'Não realizada')),
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_inventory_item_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  table_owner uuid;
  table_module text;
begin
  select owner_id, module into table_owner, table_module
  from public.module_tables
  where id = new.table_id;

  if table_owner is null or table_module <> 'inventory' then
    raise exception 'A tabela informada não pertence ao módulo Inventário';
  end if;

  if new.owner_id <> table_owner then
    raise exception 'O item deve pertencer ao mesmo proprietário da tabela';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_item_table_owner on public.inventory_items;
create trigger inventory_item_table_owner
  before insert or update of table_id, owner_id on public.inventory_items
  for each row execute procedure app.validate_inventory_item_owner();

create table if not exists public.inventory_item_logs (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null default 'update' check (action in ('create', 'update', 'delete', 'restore')),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_inventory_log_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_owner uuid;
begin
  select owner_id into item_owner from public.inventory_items where id = new.inventory_item_id;
  if item_owner is null or item_owner <> new.owner_id then
    raise exception 'O log deve pertencer ao proprietário do equipamento';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_log_item_owner on public.inventory_item_logs;
create trigger inventory_log_item_owner
  before insert or update of inventory_item_id, owner_id on public.inventory_item_logs
  for each row execute procedure app.validate_inventory_log_owner();

create table if not exists public.agenda_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('event', 'task')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_date date not null,
  due_time time without time zone,
  reminder_minutes integer not null default 0 check (reminder_minutes >= 0 and reminder_minutes <= 10080),
  priority text not null default 'normal' check (priority in ('urgent', 'periodic', 'normal')),
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Registros flexíveis reservados aos módulos que ainda estão em evolução.
-- O Inventário tem sua própria tabela tipada acima para preservar integridade.
create table if not exists public.module_records (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_module_record_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  table_owner uuid;
begin
  select owner_id into table_owner from public.module_tables where id = new.table_id;
  if table_owner is null or table_owner <> new.owner_id then
    raise exception 'O registro deve pertencer ao proprietário da tabela';
  end if;
  return new;
end;
$$;

drop trigger if exists module_record_table_owner on public.module_records;
create trigger module_record_table_owner
  before insert or update of table_id, owner_id on public.module_records
  for each row execute procedure app.validate_module_record_owner();

create table if not exists public.inventory_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'Backup do Inventário' check (char_length(btrim(label)) between 1 and 120),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source text not null default 'network' check (source in ('local', 'network', 'automatic')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.inventory_backup_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  automatic boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text not null check (module in ('inventory', 'agenda', 'control', 'flux', 'nfe')),
  operation text not null check (operation in ('pull', 'push', 'backup', 'restore')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists module_tables_owner_module_position_idx on public.module_tables (owner_id, module, position, created_at desc);
create index if not exists inventory_items_table_position_idx on public.inventory_items (table_id, position, updated_at desc);
create index if not exists inventory_items_owner_status_idx on public.inventory_items (owner_id, status, situation, cleaning_type);
create index if not exists inventory_items_owner_tag_idx on public.inventory_items (owner_id, tag) where tag <> '';
create index if not exists inventory_logs_item_created_idx on public.inventory_item_logs (inventory_item_id, created_at desc);
create index if not exists agenda_entries_owner_due_idx on public.agenda_entries (owner_id, due_date, due_time);
create index if not exists agenda_entries_owner_priority_due_idx on public.agenda_entries (owner_id, priority, due_date, due_time);
create index if not exists module_records_table_position_idx on public.module_records (table_id, position, updated_at desc);
create index if not exists inventory_backups_owner_created_idx on public.inventory_backups (owner_id, created_at desc);
create index if not exists sync_events_owner_module_created_idx on public.sync_events (owner_id, module, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure app.set_updated_at();
drop trigger if exists module_tables_set_updated_at on public.module_tables;
create trigger module_tables_set_updated_at before update on public.module_tables for each row execute procedure app.set_updated_at();
drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at before update on public.inventory_items for each row execute procedure app.set_updated_at();
drop trigger if exists agenda_entries_set_updated_at on public.agenda_entries;
create trigger agenda_entries_set_updated_at before update on public.agenda_entries for each row execute procedure app.set_updated_at();
drop trigger if exists module_records_set_updated_at on public.module_records;
create trigger module_records_set_updated_at before update on public.module_records for each row execute procedure app.set_updated_at();
drop trigger if exists inventory_backup_settings_set_updated_at on public.inventory_backup_settings;
create trigger inventory_backup_settings_set_updated_at before update on public.inventory_backup_settings for each row execute procedure app.set_updated_at();

alter table public.profiles enable row level security;
alter table public.module_tables enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_logs enable row level security;
alter table public.agenda_entries enable row level security;
alter table public.module_records enable row level security;
alter table public.inventory_backups enable row level security;
alter table public.inventory_backup_settings enable row level security;
alter table public.sync_events enable row level security;

-- Cada identidade, inclusive a anônima, enxerga e altera somente os próprios dados.
drop policy if exists "Profiles are private" on public.profiles;
create policy "Profiles are private" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "Module tables are private" on public.module_tables;
create policy "Module tables are private" on public.module_tables for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Inventory items are private" on public.inventory_items;
create policy "Inventory items are private" on public.inventory_items for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Inventory logs are private" on public.inventory_item_logs;
create policy "Inventory logs are private" on public.inventory_item_logs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Agenda entries are private" on public.agenda_entries;
create policy "Agenda entries are private" on public.agenda_entries for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Module records are private" on public.module_records;
create policy "Module records are private" on public.module_records for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Inventory backups are private" on public.inventory_backups;
create policy "Inventory backups are private" on public.inventory_backups for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Inventory backup settings are private" on public.inventory_backup_settings;
create policy "Inventory backup settings are private" on public.inventory_backup_settings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Sync events are private" on public.sync_events;
create policy "Sync events are private" on public.sync_events for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Não conceda service_role ao navegador. A Publishable Key (ou anon key legada) é suficiente com RLS ativo.
grant usage on schema public to anon, authenticated;
grant usage on schema app to anon, authenticated;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
