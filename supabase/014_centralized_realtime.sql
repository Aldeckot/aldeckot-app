-- ALDECKOT | Base corporativa centralizada e Realtime
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- Compatível com bancos que tenham ou não recebido a antiga migração 013.

begin;

-- Remove o modelo anterior por máquina/ambiente e qualquer vínculo dos dados a usuários.
alter table public.module_tables drop column if exists workspace_id cascade;
alter table public.inventory_items drop column if exists workspace_id cascade;
alter table public.inventory_item_logs drop column if exists workspace_id cascade;
alter table public.agenda_entries drop column if exists workspace_id cascade;
alter table public.module_records drop column if exists workspace_id cascade;
alter table public.inventory_backups drop column if exists workspace_id cascade;
alter table public.sync_events drop column if exists workspace_id cascade;
alter table public.control_items drop column if exists workspace_id cascade;
alter table public.control_item_logs drop column if exists workspace_id cascade;
alter table public.control_backups drop column if exists workspace_id cascade;
alter table public.flux_items drop column if exists workspace_id cascade;
alter table public.flux_item_logs drop column if exists workspace_id cascade;
alter table public.flux_backups drop column if exists workspace_id cascade;
alter table public.management_backups drop column if exists workspace_id cascade;

drop table if exists public.aldeckot_workspace_members cascade;
drop table if exists public.aldeckot_workspaces cascade;
drop function if exists public.current_shared_workspace();
drop function if exists public.configure_shared_workspace(text, text);
drop function if exists public.join_shared_workspace(text);
drop function if exists app.is_aldeckot_workspace_member(uuid);
drop function if exists app.current_aldeckot_workspace_id();

alter table public.module_tables drop column if exists owner_id cascade;
alter table public.inventory_items drop column if exists owner_id cascade;
alter table public.inventory_item_logs drop column if exists owner_id cascade;
alter table public.agenda_entries drop column if exists owner_id cascade;
alter table public.module_records drop column if exists owner_id cascade;
alter table public.inventory_backups drop column if exists owner_id cascade;
alter table public.sync_events drop column if exists owner_id cascade;
alter table public.control_items drop column if exists owner_id cascade;
alter table public.control_item_logs drop column if exists owner_id cascade;
alter table public.control_backups drop column if exists owner_id cascade;
alter table public.flux_items drop column if exists owner_id cascade;
alter table public.flux_item_logs drop column if exists owner_id cascade;
alter table public.flux_backups drop column if exists owner_id cascade;
alter table public.management_backups drop column if exists owner_id cascade;

-- Evita que validações legadas sejam acionadas durante a consolidação de tabelas.
drop trigger if exists inventory_item_table_owner on public.inventory_items;
drop trigger if exists module_record_table_owner on public.module_records;
drop trigger if exists control_item_table_owner on public.control_items;
drop trigger if exists flux_item_table_owner on public.flux_items;

-- Preferências de backup passam a ser únicas para toda a operação.
alter table public.inventory_backup_settings drop constraint if exists inventory_backup_settings_pkey;
alter table public.control_backup_settings drop constraint if exists control_backup_settings_pkey;
alter table public.flux_backup_settings drop constraint if exists flux_backup_settings_pkey;
alter table public.management_backup_settings drop constraint if exists management_backup_settings_pkey;
alter table public.inventory_backup_settings drop column if exists owner_id cascade;
alter table public.control_backup_settings drop column if exists owner_id cascade;
alter table public.flux_backup_settings drop column if exists owner_id cascade;
alter table public.management_backup_settings drop column if exists owner_id cascade;
alter table public.inventory_backup_settings add column if not exists setting_key text;
alter table public.control_backup_settings add column if not exists setting_key text;
alter table public.flux_backup_settings add column if not exists setting_key text;
alter table public.management_backup_settings add column if not exists setting_key text;
update public.inventory_backup_settings set setting_key = 'global' where setting_key is null;
update public.control_backup_settings set setting_key = 'global' where setting_key is null;
update public.flux_backup_settings set setting_key = 'global' where setting_key is null;
update public.management_backup_settings set setting_key = 'global' where setting_key is null;
delete from public.inventory_backup_settings where ctid in (select ctid from (select ctid, row_number() over (partition by setting_key order by updated_at desc) as row_number from public.inventory_backup_settings) duplicates where row_number > 1);
delete from public.control_backup_settings where ctid in (select ctid from (select ctid, row_number() over (partition by setting_key order by updated_at desc) as row_number from public.control_backup_settings) duplicates where row_number > 1);
delete from public.flux_backup_settings where ctid in (select ctid from (select ctid, row_number() over (partition by setting_key order by updated_at desc) as row_number from public.flux_backup_settings) duplicates where row_number > 1);
delete from public.management_backup_settings where ctid in (select ctid from (select ctid, row_number() over (partition by setting_key order by updated_at desc) as row_number from public.management_backup_settings) duplicates where row_number > 1);
alter table public.inventory_backup_settings alter column setting_key set default 'global';
alter table public.control_backup_settings alter column setting_key set default 'global';
alter table public.flux_backup_settings alter column setting_key set default 'global';
alter table public.management_backup_settings alter column setting_key set default 'global';
alter table public.inventory_backup_settings alter column setting_key set not null;
alter table public.control_backup_settings alter column setting_key set not null;
alter table public.flux_backup_settings alter column setting_key set not null;
alter table public.management_backup_settings alter column setting_key set not null;
alter table public.inventory_backup_settings add primary key (setting_key);
alter table public.control_backup_settings add primary key (setting_key);
alter table public.flux_backup_settings add primary key (setting_key);
alter table public.management_backup_settings add primary key (setting_key);

-- Consolida tabelas de mesmo módulo e nome que tenham vindo de navegadores diferentes.
-- Os equipamentos e registros são preservados e passam a apontar para a primeira tabela criada.
with table_map as (
  select id as old_id,
    first_value(id) over (partition by module, name order by created_at, id) as retained_id
  from public.module_tables
), duplicate_map as (
  select old_id, retained_id from table_map where old_id <> retained_id
)
update public.inventory_items item set table_id = duplicate_map.retained_id from duplicate_map where item.table_id = duplicate_map.old_id;

with table_map as (
  select id as old_id,
    first_value(id) over (partition by module, name order by created_at, id) as retained_id
  from public.module_tables
), duplicate_map as (
  select old_id, retained_id from table_map where old_id <> retained_id
)
update public.control_items item set table_id = duplicate_map.retained_id from duplicate_map where item.table_id = duplicate_map.old_id;

with table_map as (
  select id as old_id,
    first_value(id) over (partition by module, name order by created_at, id) as retained_id
  from public.module_tables
), duplicate_map as (
  select old_id, retained_id from table_map where old_id <> retained_id
)
update public.flux_items item set table_id = duplicate_map.retained_id from duplicate_map where item.table_id = duplicate_map.old_id;

with table_map as (
  select id as old_id,
    first_value(id) over (partition by module, name order by created_at, id) as retained_id
  from public.module_tables
), duplicate_map as (
  select old_id, retained_id from table_map where old_id <> retained_id
)
update public.module_records record set table_id = duplicate_map.retained_id from duplicate_map where record.table_id = duplicate_map.old_id;

with table_map as (
  select id as old_id,
    first_value(id) over (partition by module, name order by created_at, id) as retained_id
  from public.module_tables
)
delete from public.module_tables target using table_map where target.id = table_map.old_id and table_map.old_id <> table_map.retained_id;

create unique index if not exists module_tables_module_name_key on public.module_tables (module, name);
create index if not exists inventory_items_status_idx on public.inventory_items (status, situation, cleaning_type);
create index if not exists control_items_status_idx on public.control_items (status, cleaning_type);
create index if not exists flux_items_status_idx on public.flux_items (status, reason);
create index if not exists module_records_updated_idx on public.module_records (updated_at desc);
create index if not exists sync_events_created_idx on public.sync_events (created_at desc);

-- As validações mantêm a relação entre tabela, item e log sem depender de owner_id.
create or replace function app.validate_inventory_item_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'inventory' then raise exception 'A tabela informada não pertence ao módulo Inventário'; end if;
  return new;
end; $$;
drop trigger if exists inventory_item_table_owner on public.inventory_items;
create trigger inventory_item_table_owner before insert or update of table_id on public.inventory_items for each row execute procedure app.validate_inventory_item_owner();

create or replace function app.validate_inventory_log_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.inventory_items where id = new.inventory_item_id) then raise exception 'O log precisa estar vinculado a um equipamento existente'; end if;
  return new;
end; $$;
drop trigger if exists inventory_log_item_owner on public.inventory_item_logs;
create trigger inventory_log_item_owner before insert or update of inventory_item_id on public.inventory_item_logs for each row execute procedure app.validate_inventory_log_owner();

create or replace function app.validate_module_record_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.module_tables where id = new.table_id) then raise exception 'O registro precisa estar vinculado a uma tabela existente'; end if;
  return new;
end; $$;
drop trigger if exists module_record_table_owner on public.module_records;
create trigger module_record_table_owner before insert or update of table_id on public.module_records for each row execute procedure app.validate_module_record_owner();

create or replace function app.validate_control_item_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'control' then raise exception 'A tabela informada não pertence ao módulo Controle TI'; end if;
  return new;
end; $$;
drop trigger if exists control_item_table_owner on public.control_items;
create trigger control_item_table_owner before insert or update of table_id on public.control_items for each row execute procedure app.validate_control_item_owner();

create or replace function app.validate_control_log_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.control_items where id = new.control_item_id) then raise exception 'O log precisa estar vinculado a uma manutenção existente'; end if;
  return new;
end; $$;
drop trigger if exists control_log_item_owner on public.control_item_logs;
create trigger control_log_item_owner before insert or update of control_item_id on public.control_item_logs for each row execute procedure app.validate_control_log_owner();

create or replace function app.validate_flux_item_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'flux' then raise exception 'A tabela informada não pertence ao módulo Flux'; end if;
  return new;
end; $$;
drop trigger if exists flux_item_table_owner on public.flux_items;
create trigger flux_item_table_owner before insert or update of table_id on public.flux_items for each row execute procedure app.validate_flux_item_owner();

create or replace function app.validate_flux_log_owner()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.flux_items where id = new.flux_item_id) then raise exception 'O log precisa estar vinculado a uma movimentação existente'; end if;
  return new;
end; $$;
drop trigger if exists flux_log_item_owner on public.flux_item_logs;
create trigger flux_log_item_owner before insert or update of flux_item_id on public.flux_item_logs for each row execute procedure app.validate_flux_log_owner();

-- A integração Controle TI -> Inventário passa a procurar em toda a base corporativa.
create or replace function app.sync_inventory_status_from_control()
returns trigger language plpgsql security invoker set search_path = public as $$
declare inventory_status text; matched_item record; affected_tables uuid[] := array[]::uuid[];
begin
  inventory_status := case new.status
    when 'Manutenção concluída' then 'Reserva'
    when 'Em manutenção' then 'Manutenção'
    when 'Aguardando avaliação' then 'Defeito'
    when 'Em uso' then 'Atenção'
    when 'Em sala' then 'Manutenção'
    when 'Descartado' then 'Troca'
    else null
  end;
  if inventory_status is null or (nullif(btrim(new.tag), '') is null and nullif(btrim(new.serial), '') is null) then return new; end if;
  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand, item.serial, item.tag, item.status as previous_status
    from public.inventory_items item
    where item.status is distinct from inventory_status
      and ((nullif(btrim(new.tag), '') is not null and lower(btrim(item.tag)) = lower(btrim(new.tag)))
        or (nullif(btrim(new.serial), '') is not null and lower(btrim(item.serial)) = lower(btrim(new.serial))))
  loop
    update public.inventory_items set status = inventory_status where id = matched_item.id;
    insert into public.inventory_item_logs (inventory_item_id, action, message)
    values (matched_item.id, 'update', format('Status atualizado automaticamente pelo Controle TI: %s -> %s.', matched_item.previous_status, inventory_status));
    insert into public.sync_events (module, operation, details)
    values ('inventory', 'update', jsonb_build_object(
      'itemId', matched_item.id, 'tableId', matched_item.table_id,
      'tableName', (select name from public.module_tables where id = matched_item.table_id),
      'equipment', matched_item.equipment, 'brand', matched_item.brand, 'serial', matched_item.serial, 'tag', matched_item.tag, 'status', inventory_status,
      'description', format('Status sincronizado pelo Controle TI: %s -> %s.', matched_item.previous_status, inventory_status),
      'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, matched_item.id)
    ));
    affected_tables := array_append(affected_tables, matched_item.table_id);
  end loop;
  if coalesce(array_length(affected_tables, 1), 0) > 0 then
    update public.module_tables set position = position + 1 where module = 'inventory';
    update public.module_tables set position = 0 where id = any(affected_tables);
  end if;
  return new;
end; $$;

create or replace function app.record_module_record_activity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare source_module text; source_table_name text; source_action text; source_payload jsonb;
begin
  select module, name into source_module, source_table_name from public.module_tables where id = new.table_id;
  if source_module <> 'management' then return new; end if;
  source_payload := coalesce(new.payload, '{}'::jsonb);
  source_action := case when tg_op = 'INSERT' then 'create' else 'update' end;
  insert into public.sync_events (module, operation, details)
  values ('management', source_action, jsonb_build_object(
    'itemId', new.id, 'tableId', new.table_id, 'tableName', coalesce(source_table_name, 'Infraestrutura ALDECKOT'),
    'equipment', coalesce(source_payload ->> 'equipment', source_payload ->> 'name', 'Equipamento'),
    'brand', coalesce(source_payload ->> 'brand', ''), 'serial', coalesce(source_payload ->> 'serial', source_payload ->> 'numeroSerie', ''),
    'tag', coalesce(source_payload ->> 'tag', ''), 'status', coalesce(source_payload ->> 'status', 'Ativo'),
    'description', coalesce(nullif(source_payload ->> 'lastActivity', ''), case when tg_op = 'INSERT' then 'Equipamento cadastrado na Gestão TI.' else 'Equipamento atualizado na Gestão TI.' end),
    'targetUrl', format('management.html?item=%s', new.id)
  ));
  return new;
end; $$;

-- Central do Equipamento: consulta única, sem filtros por usuário, máquina ou sessão.
create or replace function public.central_equipment_search(search_term text)
returns table (id uuid, module text, table_id uuid, table_name text, equipment text, model text, brand text, serial text, tag text, status text, location text, responsible text, cleaning text, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with term as (select nullif(lower(btrim(coalesce(search_term, ''))), '') as value), records as (
    select item.id, 'inventory'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.location, ''::text, item.cleaning_type, item.notes,
      jsonb_build_object('sector', item.sector, 'situation', item.situation, 'cleaningType', item.cleaning_type), item.created_at, item.updated_at
    from public.inventory_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select item.id, 'control'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, ''::text, ''::text, item.cleaning_type, item.notes,
      jsonb_build_object('sector', item.sector, 'entryDate', item.entry_date, 'exitDate', item.exit_date), item.created_at, item.updated_at
    from public.control_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select item.id, 'flux'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.destination_company, item.receiver_responsible, ''::text, item.notes,
      jsonb_build_object('movement', item.movement, 'senderCompany', item.sender_company, 'destinationCompany', item.destination_company, 'senderResponsible', item.sender_responsible, 'receiverResponsible', item.receiver_responsible, 'sendDate', item.send_date, 'receivedDate', item.received_date, 'shippingType', item.shipping_type, 'reason', item.reason), item.created_at, item.updated_at
    from public.flux_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select module_row.id, 'management'::text, module_row.table_id, tbl.name,
      coalesce(module_row.payload ->> 'equipment', module_row.payload ->> 'equipamento', module_row.payload ->> 'name', ''), coalesce(module_row.payload ->> 'model', module_row.payload ->> 'modelo', ''), coalesce(module_row.payload ->> 'brand', module_row.payload ->> 'marca', ''),
      coalesce(module_row.payload ->> 'serial', module_row.payload ->> 'numeroSerie', module_row.payload ->> 'numero_série', module_row.payload ->> 'numero_serie', ''), coalesce(module_row.payload ->> 'tag', module_row.payload ->> 'TAG', ''), coalesce(module_row.payload ->> 'status', ''),
      coalesce(module_row.payload ->> 'location', module_row.payload ->> 'local', module_row.payload ->> 'sector', module_row.payload ->> 'setor', ''), coalesce(module_row.payload ->> 'responsible', module_row.payload ->> 'responsavel', module_row.payload ->> 'responsável', ''),
      coalesce(module_row.payload ->> 'cleaningType', module_row.payload ->> 'tipoLimpeza', module_row.payload ->> 'cleaning', module_row.payload ->> 'limpeza', module_row.payload ->> 'situation', module_row.payload ->> 'situacao', ''), coalesce(module_row.payload ->> 'notes', module_row.payload ->> 'observacoes', module_row.payload ->> 'observação', ''), module_row.payload, module_row.created_at, module_row.updated_at
    from public.module_records module_row join public.module_tables tbl on tbl.id = module_row.table_id where tbl.module = 'management'
  )
  select records.* from records cross join term
  where term.value is not null and (position(term.value in lower(coalesce(records.tag, ''))) > 0 or position(term.value in lower(coalesce(records.serial, ''))) > 0)
  order by case when lower(records.tag) = term.value or lower(records.serial) = term.value then 0 else 1 end, records.updated_at desc limit 12;
$$;

create or replace function public.central_equipment_timeline(p_tag text, p_serial text, p_item_ids uuid[] default array[]::uuid[])
returns table (id uuid, module text, operation text, description text, actor text, occurred_at timestamptz, details jsonb)
language sql stable security invoker set search_path = public as $$
  select event_row.id, event_row.module, event_row.operation, coalesce(nullif(event_row.details ->> 'description', ''), 'Registro atualizado.'), 'Equipe ALDECKOT', event_row.created_at, event_row.details
  from public.sync_events event_row
  where event_row.operation in ('create', 'update', 'delete', 'log')
    and (exists (select 1 from unnest(coalesce(p_item_ids, array[]::uuid[])) as selected_id where selected_id::text = event_row.details ->> 'itemId')
      or (nullif(btrim(coalesce(p_tag, '')), '') is not null and lower(coalesce(event_row.details ->> 'tag', '')) = lower(btrim(p_tag)))
      or (nullif(btrim(coalesce(p_serial, '')), '') is not null and lower(coalesce(event_row.details ->> 'serial', '')) = lower(btrim(p_serial))))
  order by event_row.created_at desc limit 100;
$$;

-- RLS continua ligado, mas as políticas agora representam uma única base corporativa.
grant usage on schema public to anon, authenticated;

drop policy if exists "Profiles are private" on public.profiles;
drop policy if exists "Module tables are private" on public.module_tables;
drop policy if exists "Inventory items are private" on public.inventory_items;
drop policy if exists "Inventory logs are private" on public.inventory_item_logs;
drop policy if exists "Agenda entries are private" on public.agenda_entries;
drop policy if exists "Module records are private" on public.module_records;
drop policy if exists "Inventory backups are private" on public.inventory_backups;
drop policy if exists "Inventory backup settings are private" on public.inventory_backup_settings;
drop policy if exists "Sync events are private" on public.sync_events;
drop policy if exists "Control items are private" on public.control_items;
drop policy if exists "Control logs are private" on public.control_item_logs;
drop policy if exists "Control backups are private" on public.control_backups;
drop policy if exists "Control backup settings are private" on public.control_backup_settings;
drop policy if exists "Flux items are private" on public.flux_items;
drop policy if exists "Flux logs are private" on public.flux_item_logs;
drop policy if exists "Flux backups are private" on public.flux_backups;
drop policy if exists "Flux backup settings are private" on public.flux_backup_settings;
drop policy if exists "Management backups are private" on public.management_backups;
drop policy if exists "Management backup settings are private" on public.management_backup_settings;

do $$
declare table_name text;
begin
  foreach table_name in array array['module_tables', 'inventory_items', 'inventory_item_logs', 'agenda_entries', 'module_records', 'inventory_backups', 'inventory_backup_settings', 'sync_events', 'control_items', 'control_item_logs', 'control_backups', 'control_backup_settings', 'flux_items', 'flux_item_logs', 'flux_backups', 'flux_backup_settings', 'management_backups', 'management_backup_settings']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'ALDECKOT central access', table_name);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', 'ALDECKOT central access', table_name);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated', table_name);
    execute format('alter table public.%I replica identity full', table_name);
  end loop;
end;
$$;

revoke all on public.profiles from anon, authenticated;
alter table public.profiles disable row level security;

grant execute on function public.central_equipment_search(text), public.central_equipment_timeline(text, text, uuid[]) to anon, authenticated;

-- Publica todas as alterações que alimentam módulos, gráficos, logs, notificações e a Home.
do $$
declare table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  foreach table_name in array array['module_tables', 'inventory_items', 'inventory_item_logs', 'agenda_entries', 'module_records', 'sync_events', 'control_items', 'control_item_logs', 'flux_items', 'flux_item_logs', 'inventory_backups', 'inventory_backup_settings', 'control_backups', 'control_backup_settings', 'flux_backups', 'flux_backup_settings', 'management_backups', 'management_backup_settings']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
