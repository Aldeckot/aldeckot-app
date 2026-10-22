-- Auditoria SOMENTE LEITURA dos vinculos apos as migracoes 089 e 090.
-- Nao movimenta equipamentos e retorna apenas contagens, sem nomes ou IDs.
with positions as (
  select record_row.id, record_row.management_computer_id,
    nullif(btrim(coalesce(record_row.payload ->> 'equipment', '')), '') as computer,
    btrim(coalesce(record_row.payload ->> 'terminal', '')) as terminal,
    record_row.payload
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where table_row.module = 'management'
), pdv_positions as (
  select * from positions
  where terminal ~* '^PDV[[:space:]]+[0-9]+$'
), pdv_links as (
  select position_row.id as position_id, position_row.terminal,
    peripheral.value ->> 'sourceItemId' as source_item_id,
    peripheral.value ->> 'sourceModule' as source_module,
    upper(btrim(coalesce(peripheral.value ->> 'status', ''))) as peripheral_tag,
    item.id as inventory_id, item.tag as inventory_tag,
    item.location as inventory_location
  from pdv_positions position_row
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(position_row.payload -> 'peripherals') = 'array'
      then position_row.payload -> 'peripherals' else '[]'::jsonb end
  ) as peripheral(value)
  left join public.inventory_items item
    on item.id::text = (peripheral.value ->> 'sourceItemId')
)
select jsonb_build_object(
  'checked_at', now(),
  'management_positions', (select count(*) from positions),
  'occupied_positions',
    (select count(*) from positions where management_computer_id is not null),
  'identity_occupancy_mismatch',
    (select count(*) from positions
      where (management_computer_id is null) <> (computer is null)),
  'pdv_positions', (select count(*) from pdv_positions),
  'duplicate_pdv_terminals',
    (select count(*) from (
      select lower(terminal) from pdv_positions
      group by lower(terminal) having count(*) > 1
    ) duplicate_row),
  'pdv_peripheral_links', (select count(*) from pdv_links),
  'missing_inventory_id',
    (select count(*) from pdv_links where inventory_id is null),
  'source_module_mismatch',
    (select count(*) from pdv_links where source_module is distinct from 'inventory'),
  'tag_mismatch',
    (select count(*) from pdv_links
      where inventory_id is not null
        and upper(btrim(coalesce(inventory_tag, ''))) is distinct from peripheral_tag),
  'location_mismatch',
    (select count(*) from pdv_links
      where inventory_id is not null
        and lower(btrim(coalesce(inventory_location, ''))) is distinct from lower(terminal)),
  'duplicate_inventory_ids',
    (select count(*) from (
      select inventory_id from pdv_links where inventory_id is not null
      group by inventory_id having count(*) > 1
    ) duplicate_row),
  'management_movement_events',
    (select count(*) from public.equipment_events
      where source_module = 'management'
        and action in ('computer_replacement', 'computer_transfer')),
  'peripheral_movement_events',
    (select count(*) from public.equipment_events
      where source_module = 'inventory' and action = 'peripheral-transfer'),
  'pending_or_failed_effects',
    (select count(*) from public.equipment_event_effects
      where status in ('pending', 'failed'))
) as data_report;
