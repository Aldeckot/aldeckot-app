-- ALDECKOT | Histórico compartilhado entre Controle TI e Inventário
-- Execute após 014_centralized_realtime.sql, 015_authentication_and_permissions.sql
-- e 024_control_management_status_sync.sql.
--
-- A sincronização de status Controle TI -> Inventário já existe. Esta etapa
-- complementa a integração copiando cada novo registro de histórico do
-- Controle para o item correspondente do Inventário, por TAG ou Nº de série.

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
    -- Mantém exatamente o texto registrado no Controle TI.
    insert into public.inventory_item_logs (inventory_item_id, action, message)
    values (matched_item.id, 'update', new.message);

    -- Faz o novo log também chegar à Home e à Central do Equipamento.
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

drop trigger if exists control_log_inventory_history_sync on public.control_item_logs;
create trigger control_log_inventory_history_sync
  after insert on public.control_item_logs
  for each row execute procedure app.copy_control_log_to_inventory();
