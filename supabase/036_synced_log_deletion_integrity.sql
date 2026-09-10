-- ALDECKOT | Integridade da exclusão de logs sincronizados
-- Execute após 025_control_inventory_history_sync.sql e 026_management_status_history_log.sql.
-- Um log do Controle TI copiado para Inventário ou Gestão TI passa a manter
-- uma referência à origem. Ao excluir o log original, todas as cópias são
-- removidas automaticamente e não voltam após a sincronização.

alter table public.inventory_item_logs
  add column if not exists source_module text,
  add column if not exists source_log_id uuid;

create unique index if not exists inventory_item_logs_source_log_unique
  on public.inventory_item_logs (inventory_item_id, source_module, source_log_id)
  where source_module is not null and source_log_id is not null;

create or replace function app.copy_control_log_to_inventory()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  control_item record;
  matched_item record;
begin
  select id, tag, serial
  into control_item
  from public.control_items
  where id = new.control_item_id;

  if control_item.id is null
    or (nullif(btrim(control_item.tag), '') is null and nullif(btrim(control_item.serial), '') is null) then
    return new;
  end if;

  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand, item.serial, item.tag, item.status
    from public.inventory_items item
    where (
      (nullif(btrim(control_item.tag), '') is not null
        and lower(btrim(coalesce(item.tag, ''))) = lower(btrim(control_item.tag)))
      or
      (nullif(btrim(control_item.serial), '') is not null
        and lower(btrim(coalesce(item.serial, ''))) = lower(btrim(control_item.serial)))
    )
  loop
    insert into public.inventory_item_logs (
      inventory_item_id,
      action,
      message,
      source_module,
      source_log_id
    )
    values (matched_item.id, 'update', new.message, 'control', new.id)
    on conflict (inventory_item_id, source_module, source_log_id)
      where source_module is not null and source_log_id is not null
    do update set action = excluded.action, message = excluded.message;

    insert into public.sync_events (module, operation, details)
    values (
      'inventory',
      'log',
      jsonb_build_object(
        'itemId', matched_item.id,
        'tableId', matched_item.table_id,
        'tableName', (select name from public.module_tables where id = matched_item.table_id),
        'equipment', matched_item.equipment,
        'brand', matched_item.brand,
        'serial', matched_item.serial,
        'tag', matched_item.tag,
        'status', matched_item.status,
        'description', format('Registro do Controle TI: %s', new.message),
        'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, matched_item.id)
      )
    );
  end loop;

  return new;
end;
$$;

create or replace function app.copy_control_log_to_management()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  control_item record;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
begin
  select id, tag, serial
  into control_item
  from public.control_items
  where id = new.control_item_id;

  if control_item.id is null
    or (nullif(btrim(control_item.tag), '') is null and nullif(btrim(control_item.serial), '') is null) then
    return new;
  end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (
        (nullif(btrim(control_item.tag), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = lower(btrim(control_item.tag)))
        or
        (nullif(btrim(control_item.serial), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'serial', ''))) = lower(btrim(control_item.serial)))
      )
  loop
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array'
        then matched_record.payload -> 'logs'
      else '[]'::jsonb
    end;

    if exists (
      select 1
      from jsonb_array_elements(existing_logs) as entries(entry)
      where entries.entry ->> 'controlLogId' = new.id::text
    ) then
      continue;
    end if;

    next_payload := jsonb_set(
      matched_record.payload,
      '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'at', new.created_at,
        'text', new.message,
        'source', 'Controle TI',
        'sourceModule', 'control',
        'sourceLogId', new.id::text,
        'controlLogId', new.id::text
      )),
      true
    );
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(new.message), true);

    update public.module_records
    set payload = next_payload
    where id = matched_record.id;
  end loop;

  return new;
end;
$$;

create or replace function app.remove_control_log_replicas()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.inventory_item_logs
  where source_module = 'control'
    and source_log_id = old.id;

  update public.module_records record_row
  set payload = jsonb_set(
    coalesce(record_row.payload, '{}'::jsonb),
    '{logs}',
    coalesce((
      select jsonb_agg(entries.entry)
      from jsonb_array_elements(
        case
          when jsonb_typeof(record_row.payload -> 'logs') = 'array' then record_row.payload -> 'logs'
          else '[]'::jsonb
        end
      ) as entries(entry)
      where coalesce(entries.entry ->> 'controlLogId', '') <> old.id::text
    ), '[]'::jsonb),
    true
  )
  from public.module_tables table_row
  where table_row.id = record_row.table_id
    and table_row.module = 'management'
    and exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(record_row.payload -> 'logs') = 'array' then record_row.payload -> 'logs'
          else '[]'::jsonb
        end
      ) as entries(entry)
      where entries.entry ->> 'controlLogId' = old.id::text
    );

  return old;
end;
$$;

drop trigger if exists control_log_inventory_history_sync on public.control_item_logs;
create trigger control_log_inventory_history_sync
  after insert on public.control_item_logs
  for each row execute procedure app.copy_control_log_to_inventory();

drop trigger if exists control_log_management_history_sync on public.control_item_logs;
create trigger control_log_management_history_sync
  after insert on public.control_item_logs
  for each row execute procedure app.copy_control_log_to_management();

drop trigger if exists control_log_replicas_delete on public.control_item_logs;
create trigger control_log_replicas_delete
  after delete on public.control_item_logs
  for each row execute procedure app.remove_control_log_replicas();
