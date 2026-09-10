-- Correção da sincronização Inventário -> Gestão TI.
-- Execute após 038_inventory_management_peripheral_sync.sql.
-- A base corporativa centralizada não possui owner_id nos registros. Esta versão
-- substitui a rotina criada na 038 para não depender desse campo.

begin;

create or replace function app.apply_inventory_peripheral_assignment(
  p_owner_id uuid,
  p_inventory_item_id uuid,
  p_location text,
  p_peripheral_type text,
  p_tag text,
  p_remove boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row record;
  current_peripherals jsonb;
  next_peripherals jsonb;
  next_payload jsonb;
  field_key text;
  current_value text;
  activity_message text;
  changed_count integer := 0;
begin
  if nullif(btrim(coalesce(p_location, '')), '') is null or p_peripheral_type is null or p_tag is null then
    return 0;
  end if;

  field_key := case p_peripheral_type
    when 'Impressora' then 'Impressora'
    when 'Leitor' then 'Leitor'
    when 'Gaveta' then 'Gaveta'
    when 'Pin Pad' then 'Pin Pad'
    when 'Balança' then 'Balança'
    when 'Monitor' then 'Monitor'
    when 'Teclado' then 'Teclado'
    else null
  end;

  if field_key is null then
    return 0;
  end if;

  for record_row in
    select record_item.id, record_item.payload
    from public.module_records record_item
    join public.module_tables table_row on table_row.id = record_item.table_id
    where table_row.module = 'management'
      and lower(btrim(coalesce(record_item.payload ->> 'equipment', ''))) = lower(btrim(p_location))
    for update of record_item
  loop
    current_peripherals := coalesce(record_row.payload -> 'peripherals', '{}'::jsonb);
    if jsonb_typeof(current_peripherals) <> 'object' then
      current_peripherals := '{}'::jsonb;
    end if;

    current_value := nullif(btrim(coalesce(current_peripherals ->> field_key, '')), '');
    next_peripherals := current_peripherals;

    if p_remove then
      if current_value is distinct from upper(btrim(p_tag)) then
        continue;
      end if;
      next_peripherals := next_peripherals - field_key;
      activity_message := format('Sincronização do Inventário — %s removido.', p_peripheral_type);
    else
      if not app.management_peripheral_tag_is_valid(field_key, upper(btrim(p_tag))) then
        continue;
      end if;
      next_peripherals := jsonb_set(next_peripherals, array[field_key], to_jsonb(upper(btrim(p_tag))), true);
      if current_value is not distinct from upper(btrim(p_tag)) then
        continue;
      end if;
      activity_message := format('Sincronização do Inventário — %s atualizado com a TAG %s.', p_peripheral_type, upper(btrim(p_tag)));
    end if;

    next_payload := jsonb_set(coalesce(record_row.payload, '{}'::jsonb), '{peripherals}', next_peripherals, true);
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(activity_message), true);
    update public.module_records
    set payload = next_payload
    where id = record_row.id;
    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$$;

create or replace function app.sync_inventory_peripherals_to_management()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_type text;
  previous_type text;
  clear_previous boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    previous_type := app.inventory_tag_peripheral_type(old.tag);
    clear_previous := previous_type is not null
      and nullif(btrim(coalesce(old.location, '')), '') is not null
      and (
        tg_op = 'DELETE'
        or app.inventory_tag_peripheral_type(new.tag) is distinct from previous_type
        or lower(btrim(coalesce(new.location, ''))) is distinct from lower(btrim(coalesce(old.location, '')))
      );

    if clear_previous then
      perform app.apply_inventory_peripheral_assignment(null, old.id, old.location, previous_type, old.tag, true);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  current_type := app.inventory_tag_peripheral_type(new.tag);
  if current_type is not null and nullif(btrim(coalesce(new.location, '')), '') is not null then
    perform app.apply_inventory_peripheral_assignment(null, new.id, new.location, current_type, new.tag, false);
  end if;

  return new;
end;
$$;

commit;
