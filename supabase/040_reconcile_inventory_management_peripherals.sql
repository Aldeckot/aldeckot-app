-- Correção e reconciliação dos periféricos Inventário -> Gestão TI.
-- Execute após 039_fix_inventory_management_peripheral_sync_owner.sql.
-- Além de restaurar o formato correto dos periféricos, preenche os equipamentos
-- já cadastrados antes da ativação da sincronização.

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
  matching_type boolean;
  changed_count integer := 0;
  activity_message text;
begin
  if nullif(btrim(coalesce(p_location, '')), '') is null or p_peripheral_type is null or p_tag is null then
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
    current_peripherals := case
      when jsonb_typeof(record_row.payload -> 'peripherals') = 'array' then record_row.payload -> 'peripherals'
      else '[]'::jsonb
    end;

    if p_remove then
      select coalesce(jsonb_agg(peripheral.value), '[]'::jsonb)
      into next_peripherals
      from jsonb_array_elements(current_peripherals) as peripheral(value)
      where not (
        lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type))
        and (
          coalesce(peripheral.value ->> 'sourceItemId', '') = p_inventory_item_id::text
          or upper(btrim(coalesce(peripheral.value ->> 'status', ''))) = upper(btrim(p_tag))
        )
      );
      activity_message := format('Sincronização do Inventário — %s desvinculado da TAG %s.', p_peripheral_type, upper(btrim(p_tag)));
    else
      select exists (
        select 1
        from jsonb_array_elements(current_peripherals) as peripheral(value)
        where lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type))
      ) into matching_type;

      select coalesce(jsonb_agg(
        case when lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type)) then
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(peripheral.value, '{type}', to_jsonb(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', p_peripheral_type)), true),
                '{status}', to_jsonb(upper(btrim(p_tag))), true
              ),
              '{sourceModule}', to_jsonb('inventory'::text), true
            ),
            '{sourceItemId}', to_jsonb(p_inventory_item_id::text), true
          )
        else peripheral.value end
      ), '[]'::jsonb)
      into next_peripherals
      from jsonb_array_elements(current_peripherals) as peripheral(value);

      if not matching_type then
        next_peripherals := next_peripherals || jsonb_build_array(jsonb_build_object(
          'id', format('inventory-peripheral-%s-%s', p_inventory_item_id, regexp_replace(lower(p_peripheral_type), '[[:space:]]+', '-', 'g')),
          'type', p_peripheral_type,
          'status', upper(btrim(p_tag)),
          'sourceModule', 'inventory',
          'sourceItemId', p_inventory_item_id::text
        ));
      end if;
      activity_message := format('Sincronização do Inventário — %s atualizado com a TAG %s.', p_peripheral_type, upper(btrim(p_tag)));
    end if;

    if next_peripherals is not distinct from current_peripherals then
      continue;
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

create or replace function app.reconcile_inventory_management_peripherals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inventory_item record;
  changed_count integer := 0;
begin
  for inventory_item in
    select id, tag, location
    from public.inventory_items
    where app.inventory_tag_peripheral_type(tag) is not null
      and nullif(btrim(coalesce(location, '')), '') is not null
    order by updated_at, id
  loop
    changed_count := changed_count + app.apply_inventory_peripheral_assignment(
      null,
      inventory_item.id,
      inventory_item.location,
      app.inventory_tag_peripheral_type(inventory_item.tag),
      inventory_item.tag,
      false
    );
  end loop;

  return changed_count;
end;
$$;

select app.reconcile_inventory_management_peripherals() as peripherals_synchronized;

commit;
