-- ALDECKOT | Integração de status entre Controle TI e Inventário.
-- Execute após 003_control_ti.sql, 004_recent_activity.sql e 006_inventory_cleaning.sql.

alter table public.inventory_items
  drop constraint if exists inventory_items_status_check;

alter table public.inventory_items
  add constraint inventory_items_status_check
  check (status in ('Ativo', 'Reserva', 'Manutenção', 'Troca', 'Defeito', 'Atenção'));

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

  if inventory_status is null then
    return new;
  end if;

  if nullif(btrim(new.tag), '') is null
    and nullif(btrim(new.serial), '') is null then
    return new;
  end if;

  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand, item.serial, item.tag, item.status as previous_status
    from public.inventory_items item
    where item.owner_id = new.owner_id
      and item.status is distinct from inventory_status
      and (
        (
          nullif(btrim(new.tag), '') is not null
          and lower(btrim(item.tag)) = lower(btrim(new.tag))
        )
        or (
          nullif(btrim(new.serial), '') is not null
          and lower(btrim(item.serial)) = lower(btrim(new.serial))
        )
      )
  loop
    update public.inventory_items
    set status = inventory_status
    where id = matched_item.id;

    insert into public.inventory_item_logs (inventory_item_id, action, message)
    values (
      matched_item.id,
      'update',
      format(
        'Status atualizado automaticamente pelo Controle TI: %s -> %s.',
        matched_item.previous_status,
        inventory_status
      )
    );

    insert into public.sync_events (owner_id, module, operation, details)
    values (
      new.owner_id,
      'inventory',
      'update',
      jsonb_build_object(
        'itemId', matched_item.id,
        'tableId', matched_item.table_id,
        'tableName', (
          select name
          from public.module_tables
          where id = matched_item.table_id
        ),
        'equipment', matched_item.equipment,
        'brand', matched_item.brand,
        'serial', matched_item.serial,
        'tag', matched_item.tag,
        'status', inventory_status,
        'description', format(
          'Status sincronizado pelo Controle TI: %s -> %s.',
          matched_item.previous_status,
          inventory_status
        ),
        'targetUrl', format(
          'inventory.html?table=%s&item=%s',
          matched_item.table_id,
          matched_item.id
        )
      )
    );

    affected_tables := array_append(affected_tables, matched_item.table_id);
  end loop;

  if coalesce(array_length(affected_tables, 1), 0) > 0 then
    update public.module_tables
    set position = position + 1
    where owner_id = new.owner_id
      and module = 'inventory';

    update public.module_tables
    set position = 0
    where id = any(affected_tables);
  end if;

  return new;
end;
$$;

drop trigger if exists control_item_inventory_status_sync on public.control_items;

create trigger control_item_inventory_status_sync
  after insert or update of status, tag, serial on public.control_items
  for each row execute procedure app.sync_inventory_status_from_control();
