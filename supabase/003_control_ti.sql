-- ALDECKOT | Controle TI
-- Execute esta migração no SQL Editor do Supabase após 001_aldeckot_schema.sql.

create table if not exists public.control_items (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  equipment text not null check (char_length(btrim(equipment)) between 1 and 160),
  model text not null check (char_length(btrim(model)) between 1 and 160),
  brand text not null default '',
  serial text not null default '',
  tag text not null default '',
  sector text not null default '',
  entry_date date,
  exit_date date,
  status text not null default 'Em manutenção' check (status in ('Em manutenção', 'Manutenção concluída', 'Aguardando avaliação', 'Em uso', 'Em sala', 'Descartado')),
  cleaning_type text not null default 'Não realizada' check (cleaning_type in ('Completa', 'Preventiva', 'Regular', 'Não realizada')),
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_control_item_owner()
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
  from public.module_tables where id = new.table_id;
  if table_owner is null or table_module <> 'control' then
    raise exception 'A tabela informada não pertence ao módulo Controle TI';
  end if;
  if new.owner_id <> table_owner then
    raise exception 'O item deve pertencer ao mesmo proprietário da tabela';
  end if;
  return new;
end;
$$;

drop trigger if exists control_item_table_owner on public.control_items;
create trigger control_item_table_owner
  before insert or update of table_id, owner_id on public.control_items
  for each row execute procedure app.validate_control_item_owner();

create table if not exists public.control_item_logs (
  id uuid primary key default gen_random_uuid(),
  control_item_id uuid not null references public.control_items(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null default 'update' check (action in ('create', 'update', 'delete', 'restore')),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_control_log_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_owner uuid;
begin
  select owner_id into item_owner from public.control_items where id = new.control_item_id;
  if item_owner is null or item_owner <> new.owner_id then
    raise exception 'O log deve pertencer ao proprietário do equipamento';
  end if;
  return new;
end;
$$;

drop trigger if exists control_log_item_owner on public.control_item_logs;
create trigger control_log_item_owner
  before insert or update of control_item_id, owner_id on public.control_item_logs
  for each row execute procedure app.validate_control_log_owner();

create table if not exists public.control_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'Backup do Controle TI' check (char_length(btrim(label)) between 1 and 120),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source text not null default 'network' check (source in ('local', 'network', 'automatic')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.control_backup_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  automatic boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists control_items_table_position_idx on public.control_items (table_id, position, updated_at desc);
create index if not exists control_items_owner_status_idx on public.control_items (owner_id, status, cleaning_type);
create index if not exists control_items_owner_tag_idx on public.control_items (owner_id, tag) where tag <> '';
create index if not exists control_logs_item_created_idx on public.control_item_logs (control_item_id, created_at desc);
create index if not exists control_backups_owner_created_idx on public.control_backups (owner_id, created_at desc);

drop trigger if exists control_items_set_updated_at on public.control_items;
create trigger control_items_set_updated_at before update on public.control_items for each row execute procedure app.set_updated_at();
drop trigger if exists control_backup_settings_set_updated_at on public.control_backup_settings;
create trigger control_backup_settings_set_updated_at before update on public.control_backup_settings for each row execute procedure app.set_updated_at();

alter table public.control_items enable row level security;
alter table public.control_item_logs enable row level security;
alter table public.control_backups enable row level security;
alter table public.control_backup_settings enable row level security;

drop policy if exists "Control items are private" on public.control_items;
create policy "Control items are private" on public.control_items for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Control logs are private" on public.control_item_logs;
create policy "Control logs are private" on public.control_item_logs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Control backups are private" on public.control_backups;
create policy "Control backups are private" on public.control_backups for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Control backup settings are private" on public.control_backup_settings;
create policy "Control backup settings are private" on public.control_backup_settings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.control_items, public.control_item_logs, public.control_backups, public.control_backup_settings to authenticated;
