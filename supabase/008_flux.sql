-- ALDECKOT | Módulo Flux
-- Execute após 001_aldeckot_schema.sql, 003_control_ti.sql, 004_recent_activity.sql,
-- 005_equipment_central.sql, 006_inventory_cleaning.sql e 007_control_inventory_status_sync.sql.

create table if not exists public.flux_items (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  movement text not null check (movement in ('Envio', 'Recebimento')),
  equipment text not null check (char_length(btrim(equipment)) between 1 and 160),
  model text not null check (char_length(btrim(model)) between 1 and 160),
  brand text not null check (char_length(btrim(brand)) between 1 and 160),
  serial text not null check (char_length(btrim(serial)) between 1 and 160),
  tag text not null check (char_length(btrim(tag)) between 1 and 160),
  sender_company text not null check (char_length(btrim(sender_company)) between 1 and 160),
  destination_company text not null check (char_length(btrim(destination_company)) between 1 and 160),
  sender_responsible text not null check (char_length(btrim(sender_responsible)) between 1 and 160),
  receiver_responsible text not null check (char_length(btrim(receiver_responsible)) between 1 and 160),
  send_date date not null,
  received_date date not null,
  shipping_type text not null check (shipping_type in ('Motoboy', 'Caminhão', 'Transporte Interno', 'Outro')),
  reason text not null check (reason in ('Manutenção', 'Troca', 'Aquisição', 'Transferência', 'Substituição')),
  status text not null check (status in ('Pendente', 'Recebido', 'Entregue', 'Em Trânsito')),
  notes text not null default '',
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_flux_item_owner()
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
  if table_owner is null or table_module <> 'flux' then
    raise exception 'A tabela informada não pertence ao módulo Flux';
  end if;
  if new.owner_id <> table_owner then
    raise exception 'O item deve pertencer ao mesmo proprietário da tabela';
  end if;
  return new;
end;
$$;

drop trigger if exists flux_item_table_owner on public.flux_items;
create trigger flux_item_table_owner
  before insert or update of table_id, owner_id on public.flux_items
  for each row execute procedure app.validate_flux_item_owner();

create table if not exists public.flux_item_logs (
  id uuid primary key default gen_random_uuid(),
  flux_item_id uuid not null references public.flux_items(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null default 'update' check (action in ('create', 'update', 'delete', 'restore')),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function app.validate_flux_log_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_owner uuid;
begin
  select owner_id into item_owner from public.flux_items where id = new.flux_item_id;
  if item_owner is null or item_owner <> new.owner_id then
    raise exception 'O log deve pertencer ao proprietário da movimentação';
  end if;
  return new;
end;
$$;

drop trigger if exists flux_log_item_owner on public.flux_item_logs;
create trigger flux_log_item_owner
  before insert or update of flux_item_id, owner_id on public.flux_item_logs
  for each row execute procedure app.validate_flux_log_owner();

create table if not exists public.flux_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'Backup do Flux' check (char_length(btrim(label)) between 1 and 120),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source text not null default 'network' check (source in ('local', 'network', 'automatic')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flux_backup_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  automatic boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists flux_items_table_position_idx on public.flux_items (table_id, position, updated_at desc);
create index if not exists flux_items_owner_status_idx on public.flux_items (owner_id, status, reason);
create index if not exists flux_items_owner_lower_tag_idx on public.flux_items (owner_id, lower(tag));
create index if not exists flux_items_owner_lower_serial_idx on public.flux_items (owner_id, lower(serial));
create index if not exists flux_logs_item_created_idx on public.flux_item_logs (flux_item_id, created_at desc);
create index if not exists flux_backups_owner_created_idx on public.flux_backups (owner_id, created_at desc);

drop trigger if exists flux_items_set_updated_at on public.flux_items;
create trigger flux_items_set_updated_at before update on public.flux_items for each row execute procedure app.set_updated_at();
drop trigger if exists flux_backup_settings_set_updated_at on public.flux_backup_settings;
create trigger flux_backup_settings_set_updated_at before update on public.flux_backup_settings for each row execute procedure app.set_updated_at();

alter table public.flux_items enable row level security;
alter table public.flux_item_logs enable row level security;
alter table public.flux_backups enable row level security;
alter table public.flux_backup_settings enable row level security;

drop policy if exists "Flux items are private" on public.flux_items;
create policy "Flux items are private" on public.flux_items for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Flux logs are private" on public.flux_item_logs;
create policy "Flux logs are private" on public.flux_item_logs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Flux backups are private" on public.flux_backups;
create policy "Flux backups are private" on public.flux_backups for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Flux backup settings are private" on public.flux_backup_settings;
create policy "Flux backup settings are private" on public.flux_backup_settings for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.flux_items, public.flux_item_logs, public.flux_backups, public.flux_backup_settings to authenticated;

-- A Central do Equipamento passa a consultar o registro definitivo do Flux.
create or replace function public.central_equipment_search(search_term text)
returns table (
  id uuid,
  module text,
  table_id uuid,
  table_name text,
  equipment text,
  model text,
  brand text,
  serial text,
  tag text,
  status text,
  location text,
  responsible text,
  cleaning text,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with term as (
    select nullif(lower(btrim(coalesce(search_term, ''))), '') as value
  ), records as (
    select item.id, 'inventory'::text as module, item.table_id, tbl.name as table_name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.location, ''::text as responsible, item.cleaning_type as cleaning, item.notes,
      jsonb_build_object('sector', item.sector, 'situation', item.situation, 'cleaningType', item.cleaning_type) as metadata, item.created_at, item.updated_at
    from public.inventory_items item join public.module_tables tbl on tbl.id = item.table_id
    where item.owner_id = auth.uid()

    union all

    select item.id, 'control'::text as module, item.table_id, tbl.name as table_name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, ''::text as location, ''::text as responsible, item.cleaning_type as cleaning, item.notes,
      jsonb_build_object('sector', item.sector, 'entryDate', item.entry_date, 'exitDate', item.exit_date) as metadata, item.created_at, item.updated_at
    from public.control_items item join public.module_tables tbl on tbl.id = item.table_id
    where item.owner_id = auth.uid()

    union all

    select item.id, 'flux'::text as module, item.table_id, tbl.name as table_name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.destination_company as location, item.receiver_responsible as responsible, ''::text as cleaning, item.notes,
      jsonb_build_object('movement', item.movement, 'senderCompany', item.sender_company, 'destinationCompany', item.destination_company, 'senderResponsible', item.sender_responsible, 'receiverResponsible', item.receiver_responsible, 'sendDate', item.send_date, 'receivedDate', item.received_date, 'shippingType', item.shipping_type, 'reason', item.reason) as metadata, item.created_at, item.updated_at
    from public.flux_items item join public.module_tables tbl on tbl.id = item.table_id
    where item.owner_id = auth.uid()

    union all

    select module_record.id, 'management'::text as module, module_record.table_id, tbl.name as table_name,
      coalesce(module_record.payload ->> 'equipment', module_record.payload ->> 'equipamento', module_record.payload ->> 'name', ''),
      coalesce(module_record.payload ->> 'model', module_record.payload ->> 'modelo', ''),
      coalesce(module_record.payload ->> 'brand', module_record.payload ->> 'marca', ''),
      coalesce(module_record.payload ->> 'serial', module_record.payload ->> 'numeroSerie', module_record.payload ->> 'numero_série', module_record.payload ->> 'numero_serie', ''),
      coalesce(module_record.payload ->> 'tag', module_record.payload ->> 'TAG', ''),
      coalesce(module_record.payload ->> 'status', ''),
      coalesce(module_record.payload ->> 'location', module_record.payload ->> 'local', module_record.payload ->> 'sector', module_record.payload ->> 'setor', ''),
      coalesce(module_record.payload ->> 'responsible', module_record.payload ->> 'responsavel', module_record.payload ->> 'responsável', ''),
      coalesce(module_record.payload ->> 'cleaningType', module_record.payload ->> 'tipoLimpeza', module_record.payload ->> 'cleaning', module_record.payload ->> 'limpeza', module_record.payload ->> 'situation', module_record.payload ->> 'situacao', ''),
      coalesce(module_record.payload ->> 'notes', module_record.payload ->> 'observacoes', module_record.payload ->> 'observação', ''),
      module_record.payload, module_record.created_at, module_record.updated_at
    from public.module_records module_record join public.module_tables tbl on tbl.id = module_record.table_id
    where module_record.owner_id = auth.uid() and tbl.module = 'management'
  )
  select records.* from records cross join term
  where term.value is not null and (
    position(term.value in lower(coalesce(records.tag, ''))) > 0
    or position(term.value in lower(coalesce(records.serial, ''))) > 0
  )
  order by case when lower(records.tag) = term.value or lower(records.serial) = term.value then 0 else 1 end, records.updated_at desc
  limit 12;
$$;

grant execute on function public.central_equipment_search(text) to authenticated;

-- Atualizações em tempo real da Central quando uma movimentação for alterada.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['flux_items', 'flux_item_logs']
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
