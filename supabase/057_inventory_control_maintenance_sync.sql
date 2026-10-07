-- ALDECKOT | Inventário -> Controle TI quando o status vira Manutenção.
-- Execute após 056_management_shared_office_stock_transfers.sql.
-- Não altera itens já em manutenção; sincroniza novas entradas e transições.

begin;

alter table public.control_items
  add column if not exists inventory_item_id uuid
  references public.inventory_items(id) on delete set null;

create unique index if not exists control_items_inventory_item_unique
  on public.control_items (inventory_item_id)
  where inventory_item_id is not null;

create or replace function app.sync_inventory_maintenance_to_control(p_inventory_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_item public.inventory_items%rowtype;
  current_control_table_name text;
  current_control_table_id uuid;
  control_items_require_owner boolean;
  control_item_owner_id uuid;
  existing_control_id uuid;
  existing_control_table_id uuid;
  existing_control_status text;
  existing_inventory_id uuid;
  existing_tag text;
  existing_serial text;
  source_tag text;
  source_serial text;
  matching_control_count integer;
  sync_message text;
  control_item_id uuid;
begin
  select item.* into source_item
  from public.inventory_items item
  join public.module_tables table_row on table_row.id = item.table_id
  where item.id = p_inventory_item_id
    and table_row.module = 'inventory'
    and item.status = 'Manutenção';

  if not found then return false; end if;

  current_control_table_name := app.current_control_maintenance_table_name();
  select table_row.id into current_control_table_id
  from public.module_tables table_row
  where table_row.module = 'control'
    and lower(btrim(table_row.name)) = lower(current_control_table_name)
  order by table_row.created_at desc, table_row.id desc
  limit 1;

  if current_control_table_id is null then
    raise exception 'Crie a tabela % no Controle TI antes de marcar o item para manutenção.', current_control_table_name;
  end if;

  source_tag := nullif(lower(btrim(coalesce(source_item.tag, ''))), '');
  source_serial := nullif(lower(btrim(coalesce(source_item.serial, ''))), '');
  if source_tag in ('-', '***') then source_tag := null; end if;
  if source_serial in ('-', '***') then source_serial := null; end if;

  select count(*) into matching_control_count
  from public.control_items item
  where item.inventory_item_id = p_inventory_item_id
    or (source_tag is not null and lower(btrim(coalesce(item.tag, ''))) = source_tag)
    or (source_serial is not null and lower(btrim(coalesce(item.serial, ''))) = source_serial);
  if matching_control_count > 1 then
    raise exception 'A TAG e o número de série apontam para registros diferentes no Controle TI.';
  end if;

  select item.id, item.table_id, item.status, item.inventory_item_id, item.tag, item.serial
  into existing_control_id, existing_control_table_id, existing_control_status,
       existing_inventory_id, existing_tag, existing_serial
  from public.control_items item
  where item.inventory_item_id = p_inventory_item_id
    or (source_tag is not null and lower(btrim(coalesce(item.tag, ''))) = source_tag)
    or (source_serial is not null and lower(btrim(coalesce(item.serial, ''))) = source_serial)
  order by (item.inventory_item_id = p_inventory_item_id) desc, item.updated_at desc
  limit 1
  for update;

  sync_message := format(
    'Sincronizado automaticamente do Inventário: %s marcado para manutenção.',
    source_item.equipment
  );

  if existing_control_id is not null then
    if existing_inventory_id is not null and existing_inventory_id <> p_inventory_item_id then
      raise exception 'Esta TAG ou número de série já está vinculado a outro item do Inventário no Controle TI.';
    end if;
    if existing_inventory_id is null and (
      (source_tag is not null
        and nullif(lower(btrim(coalesce(existing_tag, ''))), '') not in (source_tag, '-', '***'))
      or (source_serial is not null
        and nullif(lower(btrim(coalesce(existing_serial, ''))), '') not in (source_serial, '-', '***'))
    ) then
      raise exception 'A TAG e o número de série apontam para registros diferentes no Controle TI.';
    end if;

    if existing_control_status = 'Em manutenção'
      and existing_inventory_id = p_inventory_item_id
      and existing_control_table_id = current_control_table_id then
      return false;
    end if;

    update public.control_items
    set inventory_item_id = p_inventory_item_id,
        status = 'Em manutenção',
        table_id = case
          when existing_inventory_id = p_inventory_item_id then current_control_table_id
          else table_id
        end
    where id = existing_control_id;

    perform app.add_management_control_log(existing_control_id, 'update', sync_message);
    return true;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'control_items' and column_name = 'owner_id'
  ) into control_items_require_owner;

  if control_items_require_owner then
    select nullif(to_jsonb(table_row) ->> 'owner_id', '')::uuid
    into control_item_owner_id
    from public.module_tables table_row
    where table_row.id = current_control_table_id;

    if control_item_owner_id is null then
      raise exception 'Não foi possível identificar o proprietário da tabela do Controle TI.';
    end if;

    execute $insert_control_with_owner$
      insert into public.control_items (
        table_id, owner_id, inventory_item_id, equipment, model, brand, serial, tag,
        sector, entry_date, status, cleaning_type, notes, position
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id
    $insert_control_with_owner$
    into control_item_id
    using current_control_table_id, control_item_owner_id, p_inventory_item_id,
      source_item.equipment, source_item.model, source_item.brand, source_item.serial,
      source_item.tag, source_item.sector, current_date, 'Em manutenção',
      source_item.cleaning_type,
      'Registro criado automaticamente a partir do Inventário para acompanhamento técnico.', 0;
  else
    insert into public.control_items (
      table_id, inventory_item_id, equipment, model, brand, serial, tag,
      sector, entry_date, status, cleaning_type, notes, position
    ) values (
      current_control_table_id, p_inventory_item_id,
      source_item.equipment, source_item.model, source_item.brand, source_item.serial,
      source_item.tag, source_item.sector, current_date, 'Em manutenção',
      source_item.cleaning_type,
      'Registro criado automaticamente a partir do Inventário para acompanhamento técnico.', 0
    ) returning id into control_item_id;
  end if;

  perform app.add_management_control_log(control_item_id, 'create', sync_message);
  return true;
end;
$$;

create or replace function app.sync_control_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Uma alteração vinda do Controle TI já tem seu registro de origem.
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status <> 'Manutenção' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;

  perform app.sync_inventory_maintenance_to_control(new.id);
  return new;
end;
$$;

create or replace trigger inventory_item_control_maintenance_sync
  after insert or update of status on public.inventory_items
  for each row execute procedure app.sync_control_from_inventory();

revoke all on function app.sync_inventory_maintenance_to_control(uuid) from public, anon, authenticated;
revoke all on function app.sync_control_from_inventory() from public, anon, authenticated;

-- O vínculo explícito também mantém o retorno de status para itens sem TAG/série.
create or replace function app.sync_inventory_status_from_control()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  inventory_status text;
  matched_item record;
  affected_tables uuid[] := array[]::uuid[];
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
  if inventory_status is null then return new; end if;
  if new.inventory_item_id is null
    and nullif(btrim(new.tag), '') is null
    and nullif(btrim(new.serial), '') is null then return new; end if;

  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand, item.serial,
           item.tag, item.status as previous_status
    from public.inventory_items item
    where item.status is distinct from inventory_status
      and (
        (new.inventory_item_id is not null and item.id = new.inventory_item_id)
        or (new.inventory_item_id is null and (
          (nullif(btrim(new.tag), '') is not null
            and lower(btrim(coalesce(item.tag, ''))) = lower(btrim(new.tag)))
          or (nullif(btrim(new.serial), '') is not null
            and lower(btrim(coalesce(item.serial, ''))) = lower(btrim(new.serial)))
        ))
      )
  loop
    update public.inventory_items set status = inventory_status where id = matched_item.id;
    insert into public.inventory_item_logs (inventory_item_id, action, message)
    values (matched_item.id, 'update', format(
      'Status atualizado automaticamente pelo Controle TI: %s -> %s.',
      matched_item.previous_status, inventory_status
    ));
    insert into public.sync_events (module, operation, details)
    values ('inventory', 'update', jsonb_build_object(
      'itemId', matched_item.id, 'tableId', matched_item.table_id,
      'tableName', (select name from public.module_tables where id = matched_item.table_id),
      'equipment', matched_item.equipment, 'brand', matched_item.brand,
      'serial', matched_item.serial, 'tag', matched_item.tag, 'status', inventory_status,
      'description', format('Status sincronizado pelo Controle TI: %s -> %s.',
        matched_item.previous_status, inventory_status),
      'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, matched_item.id)
    ));
    affected_tables := array_append(affected_tables, matched_item.table_id);
  end loop;

  if coalesce(array_length(affected_tables, 1), 0) > 0 then
    update public.module_tables set position = position + 1 where module = 'inventory';
    update public.module_tables set position = 0 where id = any(affected_tables);
  end if;
  return new;
end;
$$;

-- Logs do Controle TI continuam sincronizados mesmo sem identificadores técnicos.
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
  select id, inventory_item_id, tag, serial
  into control_item
  from public.control_items
  where id = new.control_item_id;

  if control_item.id is null then return new; end if;
  if control_item.inventory_item_id is null
    and nullif(btrim(control_item.tag), '') is null
    and nullif(btrim(control_item.serial), '') is null then return new; end if;

  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand,
           item.serial, item.tag, item.status
    from public.inventory_items item
    where (control_item.inventory_item_id is not null and item.id = control_item.inventory_item_id)
      or (control_item.inventory_item_id is null and (
        (nullif(btrim(control_item.tag), '') is not null
          and lower(btrim(coalesce(item.tag, ''))) = lower(btrim(control_item.tag)))
        or (nullif(btrim(control_item.serial), '') is not null
          and lower(btrim(coalesce(item.serial, ''))) = lower(btrim(control_item.serial)))
      ))
  loop
    insert into public.inventory_item_logs (
      inventory_item_id, action, message, source_module, source_log_id
    ) values (
      matched_item.id, 'update', new.message, 'control', new.id
    )
    on conflict (inventory_item_id, source_module, source_log_id)
      where source_module is not null and source_log_id is not null
    do update set action = excluded.action, message = excluded.message;

    insert into public.sync_events (module, operation, details)
    values ('inventory', 'log', jsonb_build_object(
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
    ));
  end loop;
  return new;
end;
$$;

commit;
